# Canvas render bench

A standalone harness for measuring the canvas renderer's per-frame cost under
simulated low-end hardware, so tablet performance work can be done and verified
on a desktop instead of by feel on a device.

It mounts the real `DrawableCanvas` from `@myelin/editor` on an in-memory
`YDocManager`, with the same three-layer stack as `src/pages/canvas/index.tsx`.
Nothing is reimplemented, so what it measures is the code that ships.

## Running on the device (do this first)

The bench is an ordinary web page, so the tablet can load it over the LAN. That
is the same WebKit and the same GPU the Tauri build runs on, with no Xcode, no
signing, and no CI round trip — and it is the only measurement here that does
not depend on a proxy being faithful.

```
yarn bench:serve      # builds, then serves on all interfaces; prints a Network URL
```

Open `http://<that-address>:1431/?suite=layers` on the tablet. It runs each
configuration three times, reloading between runs, and prints a table you can
read (and select, and copy) off the screen — and posts it back to the terminal
serving it. Keep the tab in the foreground — iOS throttles
`requestAnimationFrame` in background tabs, and the run will abort with an
error rather than report zeros.

**Read the `spread` column before believing any difference.** Two runs of an
identical configuration once came back 16.90ms and 21.28ms, which is wider than
most of the effects worth chasing. A difference smaller than the spread is not
a result.

Each row differs from the one above it in one respect, so reading top to bottom
attributes cost to each change: adding a layer, painting the background into
it, holding the view still, halving the pixel ratio, adding 200 strokes.

## Running locally

```
yarn bench                       # CDP sweep: layers x dpr x raster backend
yarn bench --skip-build          # reuse the existing bench/dist
yarn bench:dev                   # interactive, at http://localhost:1430
```

Local runs are for iterating quickly on a change whose direction the device has
already confirmed. **Calibrate against the device before trusting a local
result** — see the fidelity note below, which exists because the software
backend produced a confident and wrong answer once already.

Interactive runs take the same knobs as query parameters, e.g.
`http://localhost:1430/?scene=strokes&strokes=400&layers=all&dpr=2&input=pan`.

### Knobs

| Flag / param | Values | What it isolates |
| --- | --- | --- |
| `scene` | `empty`, `strokes`, `pageframe`, `note` | Whether cost comes from elements at all |
| `strokes`, `points` | numbers | Element count vs. per-element complexity |
| `pages` | number | Page frames in the `pageframe` / `note` scenes |
| `domLayer` | `1` | Mount the app's React page-frame DOM layer, which runs its own sync loop |
| `layers` | `fg`, `fg+bg`, `all` | Cost of a layer merely existing and being cleared |
| `bg` | `blank`, `dots`, `grid` | Cost of the background *paint*, with the layer held constant. Since the background became a CSS layer rather than a canvas, this should measure as nothing while panning — a gap here is a regression in that layer's promotion |
| `dpr` | number | Backing-store pixels per CSS pixel — fill rate |
| `input` | `idle`, `pan`, `zoom`, `draw` | Whether cost depends on anything changing |
| `cpu` (driver) | throttle multiplier | CPU-bound vs. pixel-bound |
| `raster` (driver) | `gpu`, `software` | See below |
| `repeat` | count | Runs per case; the median is reported and the spread shown. Applies to both the driver and the device suite (default 3 on device) |

## Reading the numbers

`js` is time inside `DrawableCanvas.redraw`. `frame` is the wall-clock gap
between animation frames. `browser` is the difference: raster, texture upload,
compositing, GC. When `browser` dominates and `js` is ~0, the fix is to make the
browser composite something cheaper, not to make our code do less.

`spread` is the range across repeats. **A result is only meaningful if the
effect you are measuring is larger than `spread`.** Software rasterization is
CPU-bound and contends with everything else on the machine; single runs of the
same configuration varied by nearly 2x during development, which is why repeats
are the default.

### Why `software` is the useful backend

`raster=gpu` on a desktop reports thousands of frames per second because a
discrete GPU absorbs the work — it cannot reproduce a tablet's constraint and is
kept only as a control. `raster=software` (`--disable-gpu`) forces CPU
rasterization, which makes pixel throughput the bottleneck. That is the regime
an old iPad is in, and it is where per-frame costs become visible.

Chrome is also launched with `--disable-gpu-vsync --disable-frame-rate-limit
--run-all-compositor-stages-before-draw`. Without the last flag the compositor
pipeline is asynchronous, so raster happens after `requestAnimationFrame`
returns and never appears in the frame gap. Without the first two, every
scenario that fits in the budget reports exactly 16.7ms and the measurement says
nothing about headroom.

### What it cannot tell you

The iPad runs WebKit on Metal; this runs Chromium on SwiftShader. Algorithmic
costs and the broad shape of compositing cost transfer. Absolute milliseconds do
not, and WebKit-specific behaviour (such as de-accelerating 2D canvases once
total canvas memory crosses a threshold) will not reproduce here at all.

**The software backend systematically over-weights shading cost.** SwiftShader
rasterizes a `CanvasPattern` as per-pixel CPU work with texture sampling; a real
GPU draws it as a textured quad and barely notices. Measured here, switching the
background from `dots` to `blank` looked like an 11ms per-frame win. On the
actual iPad it changes almost nothing. Anything whose cost is *per pixel shaded*
rather than *per texture touched* will be exaggerated by this backend, so treat
a local win of that shape as unproven until the device agrees.

## Caveats

- `input=draw` extends a stroke by calling `addPoint` directly rather than
  synthesizing pointer events, so it measures the cost of rebuilding a growing
  stroke without the tool state machine and hit-testing around it.
- Page frames render empty. `domLayer=1` mounts the real React
  `PageFrameDomLayer` and its per-frame sync loop, but that loop runs its own
  `requestAnimationFrame` — so its cost lands in `frame` and never in `js`,
  which only wraps `DrawableCanvas.redraw`.
- The first case in a browser session reads slightly slow even after the
  per-page warmup. Compare cases within a run, and put the case you care about
  somewhere other than first.
