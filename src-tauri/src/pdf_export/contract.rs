//! Serde mirror of the TS display-list contract in `src/lib/pdf-export/contract.ts`.
//!
//! The frontend harvests the rendered DOM into a flat list of draw commands with
//! coordinates already in PDF points (top-left origin, matching krilla). Rust never
//! does layout — it just executes the commands.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontKey {
    Inter,
    Newsreader,
    Mono,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PageItem {
    Text {
        x: f32,
        baseline_y: f32,
        text: String,
        font: FontKey,
        weight: f32,
        italic: bool,
        size_pt: f32,
        color: [u8; 3],
        #[serde(default)]
        opacity: Option<f32>,
    },
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        fill: Option<[u8; 3]>,
        #[serde(default)]
        stroke: Option<[u8; 3]>,
        #[serde(default)]
        line_width: Option<f32>,
        #[serde(default)]
        opacity: Option<f32>,
    },
    Line {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        color: [u8; 3],
        width: f32,
    },
    Path {
        /// Flat list of absolute points: [x0, y0, x1, y1, ...] in PDF points.
        pts: Vec<f32>,
        closed: bool,
        #[serde(default)]
        fill: Option<[u8; 3]>,
        #[serde(default)]
        stroke: Option<[u8; 3]>,
        #[serde(default)]
        opacity: Option<f32>,
    },
    Image {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        /// Index into `PdfExportRequest::images_b64`.
        image_ref: usize,
    },
    PdfPage {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        /// Index into `PdfExportRequest::pdfs_b64`.
        pdf_ref: usize,
        /// Zero-based page index in the referenced PDF.
        page_index: usize,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPage {
    pub width_pt: f32,
    pub height_pt: f32,
    pub items: Vec<PageItem>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportKind {
    Pageframe,
    PdfElement,
    Canvas,
}

/// For `pdfElement` exports, each output page maps to an original page index or a
/// blank inserted page.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PageRef {
    Index(usize),
    /// The string "blank" (value unused — only the variant matters).
    Blank(#[allow(dead_code)] String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExportRequest {
    pub kind: ExportKind,
    pub pages: Vec<ExportPage>,
    #[serde(default)]
    pub page_map: Option<Vec<PageRef>>,
    /// Base64-encoded PNG blobs referenced by `PageItem::Image.image_ref`.
    #[serde(default)]
    pub images_b64: Vec<String>,
    /// Base64-encoded PDF blobs referenced by `PageItem::PdfPage.pdf_ref`.
    #[serde(default)]
    pub pdfs_b64: Vec<String>,
    /// Base64-encoded original PDF bytes (pdfElement only).
    #[serde(default)]
    pub original_pdf_b64: Option<String>,
}
