/**
 * Fixed-capacity sample collection with percentiles.
 *
 * Percentiles matter more than the mean here: a renderer that hits 60fps on
 * average but stalls every twentieth frame reads as smooth in a mean and reads
 * as broken to a hand holding a stylus.
 */
export class Series {
  private readonly values: number[] = [];

  public push(value: number): void {
    this.values.push(value);
  }

  public get count(): number {
    return this.values.length;
  }

  public get mean(): number {
    if (this.values.length === 0) {
      return 0;
    }
    let total = 0;
    for (const v of this.values) {
      total += v;
    }
    return total / this.values.length;
  }

  public percentile(p: number): number {
    if (this.values.length === 0) {
      return 0;
    }
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((sorted.length - 1) * p)),
    );
    return sorted[index];
  }

  public snapshot(): number[] {
    return [...this.values];
  }
}

export interface BenchResult {
  frames: number;
  /** Wall-clock gap between animation frames, ms. */
  frameMean: number;
  frameP50: number;
  frameP95: number;
  frameP99: number;
  /** Time inside `DrawableCanvas.redraw`, ms. */
  jsMean: number;
  jsP95: number;
  /**
   * Frame gap not accounted for by our redraw: the browser's share (raster,
   * texture upload, composite, GC). With vsync disabled this is the number
   * that answers "is the cost in our code or in the compositor".
   */
  browserMean: number;
  /** Frame gap expressed as a rate, for eyeballing against 60. */
  fps: number;
}

export function summarize(frame: Series, js: Series): BenchResult {
  const frameMean = frame.mean;
  const jsMean = js.mean;
  return {
    frames: frame.count,
    frameMean,
    frameP50: frame.percentile(0.5),
    frameP95: frame.percentile(0.95),
    frameP99: frame.percentile(0.99),
    jsMean,
    jsP95: js.percentile(0.95),
    browserMean: Math.max(0, frameMean - jsMean),
    fps: frameMean > 0 ? 1000 / frameMean : 0,
  };
}
