/**
 * Bridges imperative canvas elements (chrome-menu callbacks) to the app-level `<ExportDialog>`.
 * An element describes what it can export via an `ExportTarget`; the dialog renders the options and
 * calls `run` with the user's choices.
 */

export type ExportFormat = 'markdown' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  /** Only meaningful when the target sets `supportsAnnotations`. */
  includeAnnotations: boolean;
}

export interface ExportResult {
  /** The user dismissed the native save dialog — a no-op, not an error. */
  cancelled?: boolean;
  /** Non-fatal warnings to surface (e.g. code blocks that couldn't render). */
  warnings?: string[];
}

export interface ExportTarget {
  /** Display name of the thing being exported (frame/document title). */
  title: string;
  /** Formats offered; if length 1 the format picker is hidden. */
  formats: ExportFormat[];
  /** Whether to show the "include annotations" toggle. */
  supportsAnnotations: boolean;
  /** Perform the export. Owns the native save dialog; resolves with the outcome. */
  run(options: ExportOptions): Promise<ExportResult>;
}

type Opener = (target: ExportTarget) => void;

let opener: Opener | null = null;

export function setExportDialogOpener(fn: Opener | null): void {
  opener = fn;
}

export function openExportDialog(target: ExportTarget): void {
  opener?.(target);
}
