export enum ElementType {
  STROKE = 0,
  TEXT = 1,
  IMAGE = 2,
  PAGE_FRAME = 3,
  PDF = 4,
  SHAPE = 5,
  LATEX = 6,
  AUDIO = 7,
  CODE_OUTPUT = 8,
}

/**
 * Backdrops: page-sized surfaces that live on the bottom layer and are drawn
 * on top of. Their body covers the area gestures travel across, so input
 * handling treats them differently from ordinary elements.
 */
export function isBackgroundElement(type: ElementType): boolean {
  return type === ElementType.PAGE_FRAME || type === ElementType.PDF;
}
