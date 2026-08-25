/**
 * Display-list contract shared with the Rust `export_pdf` command
 * (`src-tauri/src/pdf_export/contract.rs`). The frontend harvests the rendered DOM into this flat
 * list of draw commands with coordinates already in PDF points (top-left origin, matching krilla);
 * Rust never does layout. Keep field names in sync with the Rust serde structs (camelCase).
 */

/**
 * `custom` indexes into {@link PdfExportRequest.fontsB64}. Matches the serde encoding of the Rust
 * `FontKey` enum (externally tagged).
 */
export type FontKey = 'sans' | 'serif' | 'mono' | { custom: number };

export type Rgb = [number, number, number];

export type PageItem =
  | {
      t: 'text';
      x: number;
      baselineY: number;
      text: string;
      font: FontKey;
      weight: number;
      italic: boolean;
      sizePt: number;
      color: Rgb;
      opacity?: number;
    }
  | {
      t: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: Rgb;
      stroke?: Rgb;
      lineWidth?: number;
      opacity?: number;
    }
  | {
      t: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: Rgb;
      width: number;
    }
  | {
      t: 'path';
      /** Flat absolute points [x0, y0, x1, y1, ...] in PDF points. */
      pts: number[];
      closed: boolean;
      fill?: Rgb;
      stroke?: Rgb;
      opacity?: number;
    }
  | {
      t: 'image';
      x: number;
      y: number;
      w: number;
      h: number;
      /** Index into PdfExportRequest.imagesB64. */
      imageRef: number;
    }
  | {
      t: 'pdfPage';
      x: number;
      y: number;
      w: number;
      h: number;
      /** Index into PdfExportRequest.pdfsB64. */
      pdfRef: number;
      /** Zero-based page index in the referenced PDF. */
      pageIndex: number;
    };

export interface ExportPage {
  widthPt: number;
  heightPt: number;
  items: PageItem[];
}

/** Each pdfElement output page maps to an original page index or a blank page. */
export type PageRef = number | 'blank';

export interface PdfExportRequest {
  kind: 'pageframe' | 'pdfElement' | 'canvas';
  pages: ExportPage[];
  /** pdfElement only. */
  pageMap?: PageRef[];
  /** Base64 PNG blobs referenced by image items. */
  imagesB64?: string[];
  /** Base64 TTF/OTF blobs referenced by text items' `{ custom }` font refs. */
  fontsB64?: string[];
  /** Base64 PDF blobs referenced by pdfPage items. */
  pdfsB64?: string[];
  /** Base64 original PDF bytes (pdfElement only). */
  originalPdfB64?: string;
}

// Chunked to avoid a stack overflow on large buffers.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
