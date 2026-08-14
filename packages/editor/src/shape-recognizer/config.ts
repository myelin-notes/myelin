/**
 * Tunable thresholds for the shape recognizer. All values are deterministic so
 * recognition is fully reproducible in unit tests.
 */

/** Minimum number of raw stroke points before recognition is attempted. */
export const MIN_POINTS = 8;

/** Stroke is resampled to this many points (uniform in arc length). */
export const RESAMPLE_N = 64;

/** A turn sharper than this (degrees) at an interior vertex marks a corner. */
export const CORNER_ANGLE_DEG = 45;

/**
 * Corners detected within this many resampled-index steps of each other are
 * clustered into a single physical corner.
 */
export const CORNER_CLUSTER_WINDOW = 4;

/**
 * Stroke is "closed" when the gap between its endpoints is below this fraction
 * of its total path length.
 */
export const CLOSED_RATIO = 0.18;

/** Minimum circularity (4·π·area / perimeter²) to even consider an ellipse. */
export const CIRCULARITY_MIN = 0.72;

/**
 * Above this circularity a closed stroke is forced to ellipse and can never be
 * reclassified as rect/triangle (a wobbly circle the corner detector misreads).
 */
export const ELLIPSE_STRONG = 0.8;

/** A rect/triangle must be below this circularity (else it's too round). */
export const RECT_MAX_CIRC = 0.78;

/**
 * Minimum polygon area / bbox area for a closed stroke to be a rectangle. A
 * rect fills its bounding box (~1.0) while an ellipse fills only π/4 (~0.785),
 * so this separates the two far better than circularity, whose ranges overlap
 * badly (a clean square is 0.79-0.90, a jittery circle 0.85).
 */
export const RECT_MIN_FILL = 0.82;

/**
 * Max perpendicular deviation (as a fraction of the longer bbox side) for a
 * stroke to count as a straight line.
 */
export const LINE_DEVIATION_RATIO = 0.06;

/** Minimum world-space span for a line to be accepted. */
export const MIN_LINE_SPAN = 20;

/** A line within this many degrees of horizontal snaps to exactly horizontal. */
export const LINE_HORIZONTAL_SNAP_DEG = 5;

/** Confidence below this gate yields no recognition. */
export const MIN_CONFIDENCE = 0.7;

/** Acceptable width/height aspect range for a rectangle. */
export const RECT_ASPECT_MIN = 0.33;
export const RECT_ASPECT_MAX = 3;
