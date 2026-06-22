//! Render a display-list request into PDF bytes with krilla.

use std::sync::Arc;

use base64::Engine;
use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Size, Transform};
use krilla::image::Image;
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, Stroke};
use krilla::pdf::{Pdf, PdfDocument};
use krilla::surface::Surface;
use krilla::text::TextDirection;
use krilla::Document;

use super::contract::{ExportKind, ExportPage, PageItem, PageRef, PdfExportRequest};
use super::fonts::FontRegistry;

/// CSS px per PDF point. The webview drives the `opsz` (optical size) axis off the
/// CSS px font-size (`font-optical-sizing: auto`), so the embedded font instance must
/// be selected with the px-equivalent size, not the point size, to match advances.
const PX_PER_PT: f32 = 96.0 / 72.0;

pub fn render(req: PdfExportRequest) -> Result<Vec<u8>, String> {
    let images = decode_images(&req.images_b64)?;
    let pdfs = decode_pdfs(&req.pdfs_b64)?;
    let mut fonts = FontRegistry::new();
    let mut document = Document::new();

    match req.kind {
        ExportKind::Pageframe | ExportKind::Canvas => {
            for page in &req.pages {
                render_page(&mut document, &mut fonts, &images, &pdfs, page, None, None)?;
            }
        }
        ExportKind::PdfElement => {
            let pdf_b64 = req
                .original_pdf_b64
                .as_ref()
                .ok_or("pdfElement export missing original PDF")?;
            let pdf_bytes = b64_decode(pdf_b64)?;
            let pdf =
                Pdf::new(pdf_bytes).map_err(|e| format!("failed to parse original PDF: {e:?}"))?;
            let pdf_doc = PdfDocument::new(Arc::new(pdf));
            let map = req
                .page_map
                .as_ref()
                .ok_or("pdfElement export missing pageMap")?;

            for (i, page) in req.pages.iter().enumerate() {
                let bg_idx = match map.get(i) {
                    Some(PageRef::Index(idx)) => Some(*idx),
                    _ => None,
                };
                render_page(
                    &mut document,
                    &mut fonts,
                    &images,
                    &pdfs,
                    page,
                    Some(&pdf_doc),
                    bg_idx,
                )?;
            }
        }
    }

    document
        .finish()
        .map_err(|e| format!("failed to serialize PDF: {e:?}"))
}

fn render_page(
    document: &mut Document,
    fonts: &mut FontRegistry,
    images: &[Image],
    pdfs: &[PdfDocument],
    page: &ExportPage,
    pdf_doc: Option<&PdfDocument>,
    bg_idx: Option<usize>,
) -> Result<(), String> {
    let size = Size::from_wh(page.width_pt, page.height_pt).ok_or("invalid page size")?;
    let mut pg = document.start_page_with(PageSettings::new(size));
    let mut surface = pg.surface();

    if let (Some(pdf), Some(idx)) = (pdf_doc, bg_idx) {
        surface.draw_pdf_page(pdf, size, idx);
    }

    for item in &page.items {
        draw_item(&mut surface, fonts, images, pdfs, item)?;
    }

    surface.finish();
    pg.finish();
    Ok(())
}

fn draw_item(
    surface: &mut Surface,
    fonts: &mut FontRegistry,
    images: &[Image],
    pdfs: &[PdfDocument],
    item: &PageItem,
) -> Result<(), String> {
    match item {
        PageItem::Text {
            x,
            baseline_y,
            text,
            font,
            weight,
            italic,
            size_pt,
            color,
            opacity,
        } => {
            let f = fonts
                .get(*font, *italic, *weight, *size_pt * PX_PER_PT)
                .ok_or("failed to load font instance")?;
            surface.set_stroke(None);
            surface.set_fill(Some(fill(*color, *opacity)));
            surface.draw_text(
                Point::from_xy(*x, *baseline_y),
                f,
                *size_pt,
                text,
                false,
                TextDirection::Auto,
            );
        }
        PageItem::Rect {
            x,
            y,
            w,
            h,
            fill: fill_c,
            stroke: stroke_c,
            line_width,
            opacity,
        } => {
            let mut pb = PathBuilder::new();
            pb.move_to(*x, *y);
            pb.line_to(*x + *w, *y);
            pb.line_to(*x + *w, *y + *h);
            pb.line_to(*x, *y + *h);
            pb.close();
            if let Some(path) = pb.finish() {
                paint_path(surface, &path, *fill_c, *stroke_c, *line_width, *opacity);
            }
        }
        PageItem::Line {
            x1,
            y1,
            x2,
            y2,
            color,
            width,
        } => {
            let mut pb = PathBuilder::new();
            pb.move_to(*x1, *y1);
            pb.line_to(*x2, *y2);
            if let Some(path) = pb.finish() {
                paint_path(surface, &path, None, Some(*color), Some(*width), None);
            }
        }
        PageItem::Path {
            pts,
            closed,
            fill: fill_c,
            stroke: stroke_c,
            opacity,
        } => {
            if let Some(path) = build_path(pts, *closed) {
                paint_path(surface, &path, *fill_c, *stroke_c, None, *opacity);
            }
        }
        PageItem::Image {
            x,
            y,
            w,
            h,
            image_ref,
        } => {
            let image = images
                .get(*image_ref)
                .ok_or("image_ref out of range")?
                .clone();
            let size = Size::from_wh(*w, *h).ok_or("invalid image size")?;
            surface.push_transform(&Transform::from_translate(*x, *y));
            surface.draw_image(image, size);
            surface.pop();
        }
        PageItem::PdfPage {
            x,
            y,
            w,
            h,
            pdf_ref,
            page_index,
        } => {
            let pdf = pdfs.get(*pdf_ref).ok_or("pdf_ref out of range")?;
            let size = Size::from_wh(*w, *h).ok_or("invalid pdf page size")?;
            surface.push_transform(&Transform::from_translate(*x, *y));
            surface.draw_pdf_page(pdf, size, *page_index);
            surface.pop();
        }
    }
    Ok(())
}

fn paint_path(
    surface: &mut Surface,
    path: &krilla::geom::Path,
    fill_c: Option<[u8; 3]>,
    stroke_c: Option<[u8; 3]>,
    line_width: Option<f32>,
    opacity: Option<f32>,
) {
    if let Some(c) = fill_c {
        surface.set_stroke(None);
        surface.set_fill(Some(fill(c, opacity)));
        surface.draw_path(path);
    }
    if let Some(c) = stroke_c {
        surface.set_fill(None);
        surface.set_stroke(Some(Stroke {
            paint: rgb::Color::new(c[0], c[1], c[2]).into(),
            width: line_width.unwrap_or(1.0),
            opacity: norm(opacity),
            ..Default::default()
        }));
        surface.draw_path(path);
    }
}

fn build_path(pts: &[f32], closed: bool) -> Option<krilla::geom::Path> {
    if pts.len() < 4 {
        return None;
    }
    let mut pb = PathBuilder::new();
    pb.move_to(pts[0], pts[1]);
    let mut i = 2;
    while i + 1 < pts.len() {
        pb.line_to(pts[i], pts[i + 1]);
        i += 2;
    }
    if closed {
        pb.close();
    }
    pb.finish()
}

fn fill(color: [u8; 3], opacity: Option<f32>) -> Fill {
    Fill {
        paint: rgb::Color::new(color[0], color[1], color[2]).into(),
        opacity: norm(opacity),
        rule: Default::default(),
    }
}

fn norm(opacity: Option<f32>) -> NormalizedF32 {
    NormalizedF32::new(opacity.unwrap_or(1.0).clamp(0.0, 1.0)).unwrap_or(NormalizedF32::ONE)
}

fn decode_images(images_b64: &[String]) -> Result<Vec<Image>, String> {
    images_b64
        .iter()
        .map(|b| {
            let bytes = b64_decode(b)?;
            Image::from_png(bytes.into(), false).map_err(|e| format!("failed to decode PNG: {e}"))
        })
        .collect()
}

fn decode_pdfs(pdfs_b64: &[String]) -> Result<Vec<PdfDocument>, String> {
    pdfs_b64
        .iter()
        .map(|b| {
            let bytes = b64_decode(b)?;
            let pdf = Pdf::new(bytes).map_err(|e| format!("failed to parse PDF source: {e:?}"))?;
            Ok(PdfDocument::new(Arc::new(pdf)))
        })
        .collect()
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("invalid base64: {e}"))
}
