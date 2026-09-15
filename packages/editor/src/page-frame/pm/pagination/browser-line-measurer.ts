import type { ParagraphLine } from './core';
import { DomParagraphLineMeasurer } from './dom-line-measurer';
import type {
  ParagraphLineMeasurement,
  ParagraphLineMeasurer,
} from './line-measurer';
import { PretextParagraphLineMeasurer } from './pretext-line-measurer';

// Prefer DOM rects so pagination follows the browser's actual wrapped lines.
export class BrowserParagraphLineMeasurer implements ParagraphLineMeasurer {
  private readonly pretext = new PretextParagraphLineMeasurer();

  public constructor(
    private readonly dom: ParagraphLineMeasurer = new DomParagraphLineMeasurer(),
  ) {}

  public measure(measurement: ParagraphLineMeasurement): ParagraphLine[] {
    if (measurement.metrics) {
      measurement.metrics.paragraphMeasurementCount++;
    }
    const fromDom = this.dom.measure(measurement);
    return fromDom.length > 0 ? fromDom : this.pretext.measure(measurement);
  }
}
