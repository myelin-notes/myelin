import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCanvasPerf,
  canvasPerfSummary,
  exportCanvasPerfTrace,
  flushCanvasPerfFrame,
  formatCanvasPerf,
  measureCanvasPerf,
  recordCanvasPerf,
  resetCanvasPerf,
  setCanvasPerfEnabled,
} from './canvas-perf';

beforeEach(() => {
  resetCanvasPerf();
  setCanvasPerfEnabled(true);
});

afterEach(() => {
  setCanvasPerfEnabled(false);
  resetCanvasPerf();
});

describe('layer paint rate', () => {
  it('reports the share of redraws on which a layer repainted', () => {
    // The diagnostic that matters: how many full-viewport layers get touched
    // per frame, which is what the frame time tracks — not the ms spent
    // issuing their draw calls.
    for (let i = 0; i < 10; i++) {
      addCanvasPerf('bgPaint', i < 4 ? 1 : 0);
      addCanvasPerf('fgPaint', 1);
      flushCanvasPerfFrame();
    }

    const summary = canvasPerfSummary();
    expect(summary.bgPaint).toBeCloseTo(0.4);
    expect(summary.fgPaint).toBe(1);
    // Never touched, so it flushed a zero every frame rather than no row.
    expect(summary.overlayPaint).toBe(0);
    expect(formatCanvasPerf(summary)).toContain('paint 40/100/0');
  });

  it('reads as zero before any frame has been drawn', () => {
    expect(formatCanvasPerf(canvasPerfSummary())).toContain('paint 0/0/0');
  });
});

describe('per-frame alignment', () => {
  it('gives every series a row per frame, so a trace reads across', () => {
    // Work measured outside the redraw (a skipped layer, the page-frame loop)
    // used to leave its series shorter than `frame`, which made it impossible
    // to line a slow frame up against what ran during it.
    for (let i = 0; i < 3; i++) {
      recordCanvasPerf('frame', 16);
      if (i === 1) {
        addCanvasPerf('pageFrame', 9);
      }
      flushCanvasPerfFrame();
    }

    const trace = JSON.parse(exportCanvasPerfTrace()) as {
      samples: Record<string, number[]>;
    };
    expect(trace.samples.frame).toEqual([16, 16, 16]);
    expect(trace.samples.pageFrame).toEqual([0, 9, 0]);
    expect(trace.samples.bg).toEqual([0, 0, 0]);
  });

  it('accumulates repeated measurements within one frame', () => {
    // Several pointer events can arrive between two frames; the useful number
    // is what input cost that frame, not what one event cost.
    addCanvasPerf('input', 2);
    addCanvasPerf('input', 3);
    flushCanvasPerfFrame();

    expect(canvasPerfSummary().input).toBe(5);
  });
});

describe('canvas perf sampling', () => {
  it('records nothing while disabled', () => {
    setCanvasPerfEnabled(false);
    recordCanvasPerf('frame', 25);

    expect(canvasPerfSummary().frame).toBe(0);
  });

  it('averages the samples in the window', () => {
    recordCanvasPerf('frame', 10);
    recordCanvasPerf('frame', 20);
    recordCanvasPerf('frame', 30);

    expect(canvasPerfSummary().frame).toBeCloseTo(20);
  });

  it('attributes the gap between frame time and our js to the browser', () => {
    recordCanvasPerf('frame', 25);
    recordCanvasPerf('js', 2);

    const summary = canvasPerfSummary();
    expect(summary.browser).toBeCloseTo(23);
  });

  it('never reports negative browser time', () => {
    recordCanvasPerf('frame', 1);
    recordCanvasPerf('js', 5);

    expect(canvasPerfSummary().browser).toBe(0);
  });

  it('surfaces a sustained stall rate in the p95 while the mean stays low', () => {
    // 10% stalled frames: the mean barely moves, but a p95 is meant to land in
    // the stalled tail. A lone 1-in-100 spike correctly would not move it.
    for (let i = 0; i < 90; i++) {
      recordCanvasPerf('frame', 16);
    }
    for (let i = 0; i < 10; i++) {
      recordCanvasPerf('frame', 200);
    }

    const summary = canvasPerfSummary();
    expect(summary.frame).toBeLessThan(40);
    expect(summary.frameP95).toBe(200);
  });

  it('keeps only the most recent window of samples', () => {
    // A full window of fast frames must fully displace the slow ones before
    // them, or the readout would lag behind what the device is doing now.
    for (let i = 0; i < 400; i++) {
      recordCanvasPerf('frame', 100);
    }
    for (let i = 0; i < 300; i++) {
      recordCanvasPerf('frame', 16);
    }

    expect(canvasPerfSummary().frame).toBeCloseTo(16);
  });

  it('measureCanvasPerf returns the callback result and records a sample', () => {
    const result = measureCanvasPerf('bg', () => 'drawn');

    expect(result).toBe('drawn');
    expect(canvasPerfSummary().bg).toBeGreaterThanOrEqual(0);
  });

  it('measureCanvasPerf still returns the result when disabled', () => {
    setCanvasPerfEnabled(false);
    expect(measureCanvasPerf('bg', () => 42)).toBe(42);
  });

  it('exports retained samples oldest first, including across a wrap', () => {
    // 320 samples into a 300-slot buffer: the first 20 fall off the front.
    for (let i = 0; i < 320; i++) {
      recordCanvasPerf('frame', i);
    }

    const trace = JSON.parse(exportCanvasPerfTrace()) as {
      samples: Record<string, number[]>;
    };
    const frames = trace.samples.frame;
    expect(frames).toHaveLength(300);
    expect(frames[0]).toBe(20);
    expect(frames[299]).toBe(319);
  });

  it('exports in order before the buffer wraps', () => {
    recordCanvasPerf('frame', 1);
    recordCanvasPerf('frame', 2);
    recordCanvasPerf('frame', 3);

    const trace = JSON.parse(exportCanvasPerfTrace()) as {
      samples: Record<string, number[]>;
    };
    expect(trace.samples.frame).toEqual([1, 2, 3]);
  });

  it('carries the caller context into the trace', () => {
    const trace = JSON.parse(exportCanvasPerfTrace({ elementCount: 7 })) as {
      elementCount: number;
    };
    expect(trace.elementCount).toBe(7);
  });

  it('formats every field on one line', () => {
    recordCanvasPerf('frame', 25);
    recordCanvasPerf('js', 2);

    const line = formatCanvasPerf(canvasPerfSummary());
    expect(line).toContain('f 25.0');
    expect(line).toContain('js 2.0');
    expect(line).toContain('br 23.0');
    expect(line).not.toContain('\n');
  });
});
