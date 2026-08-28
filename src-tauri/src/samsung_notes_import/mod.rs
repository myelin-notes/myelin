//! Samsung Notes (.sdocx) parsing for the library importer.
//!
//! Built on the reverse-engineered `sdocx` crate, so coverage is partial by
//! nature: handwriting strokes and typed text convert; images, shapes, tables,
//! and embedded PDF backgrounds are counted into `skipped_objects` instead.
//! Coordinates pass through unchanged — stroke points and object rects already
//! share the page's pixel space, which the frontend treats as world px.

use std::io::Write as _;
use std::path::Path;

use sdocx::page::object::stroke::{Stroke, ToolType};
use sdocx::{DocObject, Document};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_fs::{FilePath, FsExt};

/// Fallback for strokes whose pen size is absent from the file, in page px.
const DEFAULT_PEN_SIZE: f32 = 2.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedNote {
    pages: Vec<ImportedPage>,
    /// Objects the parser understood but the import cannot represent yet
    /// (images, shapes, tables, PDF backgrounds, ...).
    skipped_objects: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPage {
    width: f32,
    height: f32,
    elements: Vec<ImportedElement>,
}

#[derive(Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum ImportedElement {
    Stroke {
        /// Flat `[x, y, pressure, ...]` in page px; pressure is 0..1, all zero
        /// when `has_pressure` is false.
        points: Vec<f32>,
        color: String,
        size: f32,
        has_pressure: bool,
    },
    Text {
        x: f32,
        y: f32,
        width: f32,
        text: String,
    },
}

/// The file is read here rather than sent over the IPC: Android cannot carry a
/// raw invoke body, and a JSON number array would balloon a multi-megabyte
/// note. `FilePath` + `FsExt` also resolve Android `content://` URIs.
#[tauri::command]
pub async fn parse_samsung_notes(app: AppHandle, path: FilePath) -> Result<ImportedNote, String> {
    // Parsing a large note is CPU-bound; keep it off the async runtime.
    tokio::task::spawn_blocking(move || match path {
        FilePath::Path(path) => parse_document(&path),
        // `Document::from_zip` only takes a filesystem path, so a content://
        // URI is spooled through a temp file.
        uri => {
            let bytes = app
                .fs()
                .read(uri)
                .map_err(|e| format!("failed to read Samsung Notes file: {e}"))?;
            let mut file = tempfile::NamedTempFile::new()
                .map_err(|e| format!("failed to create temp file: {e}"))?;
            file.write_all(&bytes)
                .map_err(|e| format!("failed to write temp file: {e}"))?;
            parse_document(file.path())
        }
    })
    .await
    .map_err(|e| format!("Samsung Notes parse task panicked: {e}"))?
}

fn parse_document(path: &Path) -> Result<ImportedNote, String> {
    let (document, _media) =
        Document::from_zip(path).map_err(|e| format!("failed to parse Samsung Notes file: {e}"))?;
    Ok(convert_document(&document))
}

fn convert_document(document: &Document) -> ImportedNote {
    let mut skipped_objects: u32 = 0;

    let pages = document
        .pages()
        .iter()
        .map(|page| {
            skipped_objects += page.embedded_pdf_pages().len() as u32;

            let mut elements = Vec::new();
            for layer in page.layers() {
                for object in layer.objects() {
                    match object {
                        DocObject::Stroke(stroke) => {
                            // An eraser stroke is a gesture, not content.
                            if matches!(stroke.tool_type(), ToolType::Eraser) {
                                continue;
                            }
                            elements.push(convert_stroke(stroke));
                        }
                        DocObject::Text(text) => {
                            let trimmed = text.raw_string().map(str::trim).unwrap_or_default();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let rect = object.object_base().rect;
                            elements.push(ImportedElement::Text {
                                x: rect.min.x as f32,
                                y: rect.min.y as f32,
                                width: rect.width() as f32,
                                text: trimmed.to_string(),
                            });
                        }
                        _ => skipped_objects += 1,
                    }
                }
            }

            ImportedPage {
                width: page.width as f32,
                height: page.height as f32,
                elements,
            }
        })
        .collect();

    ImportedNote {
        pages,
        skipped_objects,
    }
}

fn convert_stroke(stroke: &Stroke) -> ImportedElement {
    let events = stroke.events();

    // Finger/mouse input reports one constant pressure for the whole stroke;
    // only pass pressure through when it actually varies.
    let first_pressure = events.first().map_or(0.0, |e| e.pressure);
    let has_pressure = events
        .iter()
        .any(|e| (e.pressure - first_pressure).abs() > 0.01);

    let mut points = Vec::with_capacity(events.len() * 3);
    for event in events {
        points.push(event.point.x as f32);
        points.push(event.point.y as f32);
        points.push(if has_pressure {
            event.pressure.clamp(0.0, 1.0)
        } else {
            0.0
        });
    }

    ImportedElement::Stroke {
        points,
        color: css_color(stroke.colour()),
        size: stroke.pen_size().unwrap_or(DEFAULT_PEN_SIZE),
        has_pressure,
    }
}

// Stroke colour is stored BGRA. Alpha carries highlighter translucency.
fn css_color([b, g, r, a]: [u8; 4]) -> String {
    if a == u8::MAX {
        format!("#{r:02x}{g:02x}{b:02x}")
    } else {
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    }
}
