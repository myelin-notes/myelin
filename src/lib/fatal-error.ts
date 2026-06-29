// Captures failures that happen *before* the app finishes mounting — the window
// where the normal Logger (which only writes once app code calls it) and PostHog
// are not yet running, so a thrown error would otherwise leave a blank window
// with no log and no on-screen feedback.
//
// This module is deliberately dependency-light: it has no top-level imports, and
// the only host API it touches (the Tauri fs plugin) is pulled in via dynamic
// import inside the writer. That guarantees importing this module can never
// itself throw during early bootstrap, so it stays available to report whatever
// fails next.

let booted = false;
let reported = false;

interface FormattedError {
  message: string;
  stack?: string;
}

// Marks startup as complete. After this point the app is mounted and the normal
// Logger / PostHog own error reporting, so reportFatalError() becomes a no-op
// and a later non-fatal error never wipes a working UI.
export function markBootComplete(): void {
  booted = true;
}

// Reports a pre-mount failure: renders a visible panel and appends the error to
// the same log file the Logger uses (logs/app.log). Only the first pre-boot
// failure is acted on; once mounted, it does nothing.
export async function reportFatalError(
  source: string,
  error: unknown,
): Promise<void> {
  if (booted || reported) {
    return;
  }
  reported = true;

  renderFatalError(error);

  try {
    await writeStartupErrorLog(source, error);
  } catch (writeError) {
    // Last resort: the fs write itself failed (e.g. permissions). Keep the
    // on-screen panel; surface the write failure to the console only.
    console.error('[fatal-error] failed to write startup log', writeError);
  }
}

function formatError(error: unknown): FormattedError {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack };
  }
  return { message: String(error) };
}

async function writeStartupErrorLog(
  source: string,
  error: unknown,
): Promise<void> {
  const { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } =
    await import('@tauri-apps/plugin-fs');

  const { message, stack } = formatError(error);
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    subsystem: 'bootstrap',
    source,
    message,
    stack,
  });

  const dir = 'logs';
  const file = 'logs/app.log';
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  }
  const existing = (await exists(file, { baseDir: BaseDirectory.AppData }))
    ? await readTextFile(file, { baseDir: BaseDirectory.AppData })
    : '';
  await writeTextFile(file, `${existing}${entry}\n`, {
    baseDir: BaseDirectory.AppData,
  });
}

// Renders a minimal, framework-free panel into #root using inline styles, so it
// shows even when React failed to load or the stylesheet never applied.
function renderFatalError(error: unknown): void {
  const { message, stack } = formatError(error);
  const root = document.getElementById('root') ?? document.body;

  const container = document.createElement('div');
  container.setAttribute(
    'style',
    'position:fixed;inset:0;overflow:auto;padding:32px;' +
      'font-family:-apple-system,system-ui,sans-serif;background:#1e1e1e;color:#eaeaea;',
  );

  const heading = document.createElement('h1');
  heading.textContent = 'Myelin failed to start';
  heading.setAttribute('style', 'font-size:18px;margin:0 0 12px;');

  const msg = document.createElement('p');
  msg.textContent = message;
  msg.setAttribute('style', 'color:#ff8a80;margin:0 0 16px;font-weight:600;');

  const hint = document.createElement('p');
  hint.textContent =
    'This error was saved to logs/app.log. Please send that file to support.';
  hint.setAttribute('style', 'color:#9aa0a6;margin:0 0 16px;font-size:13px;');

  const children: HTMLElement[] = [heading, msg, hint];
  if (stack) {
    const pre = document.createElement('pre');
    pre.textContent = stack;
    pre.setAttribute(
      'style',
      'white-space:pre-wrap;font-size:12px;color:#c5c8c6;' +
        'background:#111;padding:12px;border-radius:6px;margin:0;',
    );
    children.push(pre);
  }

  container.append(...children);
  root.replaceChildren(container);
}
