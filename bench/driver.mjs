/**
 * Runs the canvas bench across a matrix of simulated-hardware configurations
 * and prints a comparison table.
 *
 * The question it exists to answer: with one or two elements on screen, where
 * does the frame budget go? It sweeps the number of mounted canvas layers, the
 * backing-store scale, and the rasterization backend, so the cost of *existing*
 * as a full-viewport layer can be separated from the cost of drawing into one.
 *
 * No third-party dependencies: Chrome is driven over CDP with Node's built-in
 * fetch and WebSocket.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatTraceReport,
  startTracing,
  summarizeTrace,
  writeTrace,
} from './trace.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BENCH_DIR, '..');
/**
 * Vite is invoked through its JS entry under this Node rather than through
 * `yarn vite`, so there is no intermediate shell. On Windows, killing a shell
 * wrapper leaves the real server holding the port, and the next run fails to
 * bind.
 */
const VITE_BIN = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const VITE_CONFIG = path.join(BENCH_DIR, 'vite.config.ts');
const PREVIEW_PORT = 1431;
const CDP_PORT = 9333;

/**
 * iPad-class logical viewport. Layer cost scales with area, so the viewport has
 * to match the device under investigation or the numbers do not transfer.
 */
const VIEWPORT = { width: 1180, height: 820 };

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=');
      // A flag followed by another flag is a boolean, not a flag whose value
      // happens to look like one.
      const next = argv[i + 1];
      if (inline !== undefined) {
        args[key] = inline;
      } else if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function list(value, fallback) {
  return value === undefined ? fallback : String(value).split(',');
}

/**
 * The default sweep. `empty` + `pan` is the diagnostic case: nothing to draw,
 * but the view changes every frame, so every mounted layer must repaint. If
 * frame time scales with layer count and with dpr squared, the cost is pixels,
 * not elements.
 */
const MATRIX = {
  scene: list(args.scene, ['empty']),
  input: list(args.input, ['pan']),
  layers: list(args.layers, ['fg', 'fg+bg', 'all']),
  bg: list(args.bg, ['dots']),
  dpr: list(args.dpr, ['1', '2', '3']),
  cpu: list(args.cpu, ['1']),
  raster: list(args.raster, ['gpu', 'software']),
  strokes: list(args.strokes, ['0']),
  points: list(args.points, ['64']),
  pages: list(args.pages, ['1']),
  domLayer: list(args.domLayer, ['0']),
  bgRaster: list(args.bgRaster, ['stepped']),
  promoteFrame: list(args.promoteFrame, ['0']),
  frameShadow: list(args.frameShadow, ['on']),
  plainFrame: list(args.plainFrame, ['']),
  chromePromoted: list(args.chromePromoted, ['1']),
  frameEditor: list(args.frameEditor, ['1']),
  chromeRescaled: list(args.chromeRescaled, ['1']),
};

const DURATION_MS = Number(args.duration ?? 4000);
const WARMUP_MS = Number(args.warmup ?? 600);
const HEADLESS = args.headless === 'true';

/**
 * Times each case is run, with the median reported.
 *
 * Software rasterization is CPU-bound and contends with whatever else the
 * machine is doing, which moved a repeated measurement by nearly 2x during
 * development. A single sample per case is not enough to tell an optimization
 * from a busy moment, so every case is run several times and the spread is
 * printed alongside the median — a `spread` comparable to the effect being
 * measured means the result is noise.
 */
const REPEAT = Number(args.repeat ?? 3);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files/Google/Chrome Dev/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!found) {
    throw new Error(
      'Could not find Chrome. Set CHROME_PATH to the executable and re-run.',
    );
  }
  return found;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      cwd: REPO_ROOT,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** Minimal CDP client over a page target's WebSocket. */
class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async attach(port) {
    const response = await waitForHttp(
      `http://127.0.0.1:${port}/json/list`,
      20_000,
    );
    const targets = await response.json();
    const page = targets.find((t) => t.type === 'page');
    if (!page) {
      throw new Error('Chrome exposed no page target to attach to');
    }
    const client = new Cdp();
    await client.#connect(page.webSocketDebuggerUrl);
    return client;
  }

  #connect(url) {
    return new Promise((resolve, reject) => {
      this.#socket = new WebSocket(url);
      this.#socket.addEventListener('open', () => resolve());
      this.#socket.addEventListener('error', () =>
        reject(new Error('CDP websocket error')),
      );
      this.#socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id === undefined) {
          for (const handler of this.#listeners.get(message.method) ?? []) {
            handler(message.params);
          }
          return;
        }
        const entry = this.#pending.get(message.id);
        if (!entry) {
          return;
        }
        this.#pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(`${message.error.message} (${entry.method})`));
        } else {
          entry.resolve(message.result);
        }
      });
    });
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? [];
    handlers.push(handler);
    this.#listeners.set(method, handlers);
  }

  once(method, handler) {
    const wrapped = (params) => {
      this.#listeners.set(
        method,
        (this.#listeners.get(method) ?? []).filter((h) => h !== wrapped),
      );
      handler(params);
    };
    this.on(method, wrapped);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket?.close();
  }
}

function benchUrl(config, extra = {}) {
  const params = new URLSearchParams({
    scene: config.scene,
    input: config.input,
    layers: config.layers,
    bg: config.bg,
    dpr: config.dpr,
    strokes: config.strokes,
    points: config.points,
    pages: config.pages,
    domLayer: config.domLayer,
    bgRaster: config.bgRaster,
    promoteFrame: config.promoteFrame,
    frameShadow: config.frameShadow,
    plainFrame: config.plainFrame,
    chromePromoted: config.chromePromoted,
    frameEditor: config.frameEditor,
    chromeRescaled: config.chromeRescaled,
    warmup: String(WARMUP_MS),
    duration: String(DURATION_MS),
    auto: '1',
    ...extra,
  });
  return `http://127.0.0.1:${PREVIEW_PORT}/?${params}`;
}

async function applyEmulation(cdp, config) {
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: Number(config.cpu),
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    // The scenario overrides `devicePixelRatio` itself so that only the canvas
    // backing stores change size; scaling here as well would rescale layout
    // too and confound the two.
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function waitForResult(cdp, config) {
  const deadline = Date.now() + WARMUP_MS + DURATION_MS + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const { result } = await cdp.send('Runtime.evaluate', {
      expression:
        'window.__benchError ? JSON.stringify({error: window.__benchError}) : (window.__benchResult ? JSON.stringify(window.__benchResult) : null)',
      returnByValue: true,
    });
    if (typeof result.value === 'string') {
      const parsed = JSON.parse(result.value);
      if (parsed.error) {
        throw new Error(`bench page failed: ${parsed.error}`);
      }
      return parsed;
    }
  }
  throw new Error(`Timed out running ${JSON.stringify(config)}`);
}

async function runCase(cdp, config) {
  await applyEmulation(cdp, config);
  await cdp.send('Page.navigate', { url: benchUrl(config) });
  return waitForResult(cdp, config);
}

function chromeFlags(raster, profileDir) {
  const flags = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    // Uncap rAF. Pinned to vsync every scenario that fits in the budget reports
    // exactly 16.7ms and the measurement says nothing about headroom; uncapped,
    // the frame gap is the actual cost of producing a frame.
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    // Without this the compositor pipeline is asynchronous, so raster and
    // draw happen after rAF returns and never show up in the frame gap — a
    // desktop GPU then reports thousands of "frames" per second while doing
    // the work off to the side. Running every stage before the draw makes the
    // frame gap include the cost of actually producing the frame, which is
    // the quantity under investigation.
    '--run-all-compositor-stages-before-draw',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ];
  if (raster === 'software') {
    // Forces CPU rasterization, which makes pixel throughput the bottleneck —
    // the closest local proxy for a bandwidth-starved mobile GPU.
    flags.unshift('--disable-gpu');
  }
  if (HEADLESS) {
    flags.unshift('--headless=new');
  }
  return flags;
}

/**
 * Record one case with tracing on and print where its frame actually goes.
 *
 * One case, not a sweep: a trace answers "what is this frame made of", and the
 * way to use it is to trace the configuration a sweep has already shown to be
 * slow. Every axis takes its first value, so the same flags that select a row
 * in the table select the case to trace.
 */
async function traceOnce(chromePath, profileDirs) {
  const config = Object.fromEntries(
    Object.entries(MATRIX).map(([key, values]) => [key, values[0]]),
  );
  const profileDir = mkdtempSync(path.join(tmpdir(), 'myelin-bench-'));
  profileDirs.push(profileDir);
  const chrome = spawn(chromePath, chromeFlags(config.raster, profileDir), {
    stdio: 'ignore',
  });

  let cdp;
  try {
    cdp = await Cdp.attach(CDP_PORT);
    await applyEmulation(cdp, config);
    await cdp.send('Page.navigate', {
      url: benchUrl(config, { mark: '1' }),
    });

    // Start recording after the warmup has elapsed. Traced from the first
    // frame, the loudest entries are scene construction, script compilation and
    // first paint — none of which happen again, and all of which would swamp
    // the steady-state cost the trace exists to show.
    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS + 500));
    console.log(`Tracing ${JSON.stringify(config)} …`);
    const tracing = await startTracing(cdp);
    const result = await waitForResult(cdp, config);
    const events = await tracing.stop();

    console.log(
      `\nbench: ${result.fps.toFixed(1)} fps  frame ${result.frameMean.toFixed(2)}  js ${result.jsMean.toFixed(2)}  other ${result.otherJsMean.toFixed(2)}  browser ${result.browserMean.toFixed(2)}\n`,
    );
    console.log(formatTraceReport(summarizeTrace(events)));

    const outPath = path.resolve(
      REPO_ROOT,
      args['trace-out'] ??
        `bench/trace-${config.scene}-${config.input}-${config.raster}.json`,
    );
    writeTrace(outPath, events);
    console.log(
      `\nWrote ${outPath} (${events.length} events) — open it in DevTools ▸ Performance ▸ Load profile`,
    );
  } finally {
    cdp?.close();
    chrome.kill();
  }
}

function expand(matrix) {
  let cases = [{}];
  for (const [key, values] of Object.entries(matrix)) {
    cases = cases.flatMap((base) =>
      values.map((value) => ({ ...base, [key]: value })),
    );
  }
  return cases;
}

function printTable(rows) {
  const columns = [
    ['raster', (r) => r.config.raster],
    ['layers', (r) => r.config.layers],
    ['bg', (r) => r.config.bg],
    ['dpr', (r) => r.config.dpr],
    ['cpu', (r) => `${r.config.cpu}x`],
    ['scene', (r) => `${r.config.scene}/${r.config.input}`],
    ['fps', (r) => r.fps.toFixed(1)],
    ['frame', (r) => r.frameMean.toFixed(2)],
    ['spread', (r) => r.spread.toFixed(2)],
    ['p95', (r) => r.frameP95.toFixed(2)],
    ['js', (r) => r.jsMean.toFixed(2)],
    ['other', (r) => r.otherJsMean.toFixed(2)],
    ['browser', (r) => r.browserMean.toFixed(2)],
  ];
  const cells = [
    columns.map(([header]) => header),
    ...rows.map((row) => columns.map(([, get]) => String(get(row)))),
  ];
  const widths = cells[0].map((_, i) =>
    Math.max(...cells.map((row) => row[i].length)),
  );
  for (const [index, row] of cells.entries()) {
    console.log(row.map((cell, i) => cell.padStart(widths[i])).join('  '));
    if (index === 0) {
      console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    }
  }
}

async function main() {
  if (args['skip-build'] === undefined) {
    console.log('Building bench…');
    await run(process.execPath, [VITE_BIN, 'build', '--config', VITE_CONFIG]);
  }

  const preview = spawn(
    process.execPath,
    [VITE_BIN, 'preview', '--config', VITE_CONFIG],
    { stdio: 'ignore', cwd: REPO_ROOT },
  );
  const chromePath = findChrome();
  const profileDirs = [];
  const rows = [];

  try {
    await waitForHttp(`http://127.0.0.1:${PREVIEW_PORT}/`, 30_000);

    if (args.trace !== undefined) {
      await traceOnce(chromePath, profileDirs);
      return;
    }

    // Rasterization backend is a launch flag, so it brackets the sweep: one
    // browser per backend, every other axis varied inside it.
    for (const raster of MATRIX.raster) {
      const profileDir = mkdtempSync(path.join(tmpdir(), 'myelin-bench-'));
      profileDirs.push(profileDir);
      const chrome = spawn(chromePath, chromeFlags(raster, profileDir), {
        stdio: 'ignore',
      });
      let cdp;
      try {
        cdp = await Cdp.attach(CDP_PORT);
        const cases = expand({ ...MATRIX, raster: [raster] });
        for (const config of cases) {
          process.stdout.write(
            `run ${raster} layers=${config.layers} dpr=${config.dpr} cpu=${config.cpu}x … `,
          );
          const samples = [];
          for (let i = 0; i < REPEAT; i++) {
            samples.push(await runCase(cdp, config));
          }
          const frameMeans = samples.map((s) => s.frameMean);
          // Report the run whose frame mean is the median, so every field in
          // the row comes from one coherent run rather than being averaged
          // across runs that disagree.
          const chosen = samples.find(
            (s) => s.frameMean === median(frameMeans),
          );
          const spread = Math.max(...frameMeans) - Math.min(...frameMeans);
          rows.push({ ...chosen, spread, config });
          console.log(
            `${chosen.fps.toFixed(1)} fps (spread ${spread.toFixed(2)}ms over ${REPEAT})`,
          );
        }
      } finally {
        cdp?.close();
        chrome.kill();
      }
    }

    console.log('');
    printTable(rows);

    const outPath = path.resolve(REPO_ROOT, args.out ?? 'bench/last-run.json');
    writeFileSync(
      outPath,
      JSON.stringify({ viewport: VIEWPORT, rows }, null, 2),
    );
    console.log(`\nWrote ${outPath}`);
  } finally {
    preview.kill();
    for (const dir of profileDirs) {
      // Chrome can still be releasing handles as we exit; a leftover temp
      // profile is not worth failing a completed run over.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
