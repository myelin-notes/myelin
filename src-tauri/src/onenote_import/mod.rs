//! OneNote parsing for the library importer, covering both a bare `.one`
//! section and a `.onepkg` notebook archive.
//!
//! The frontend hands over the raw bytes and gets back a flat, canvas-ready
//! model in CSS pixels. Building the Yjs document stays in TypeScript alongside
//! the other importers; this module only decodes and converts units.

use std::io;

use base64::Engine as _;
use onenote_parser::Parser;
use onenote_parser::contents::{
    Content, EmbeddedObject, Image, Ink, Outline, OutlineItem, RichText, Table,
};
use onenote_parser::fs::FileSystem;
use onenote_parser::page::{Page, PageContent};
use onenote_parser::property::common::ColorRef;
use onenote_parser::section::{Section, SectionEntry};
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use typed_path::{TypedPath, TypedPathBuf};

/// [MS-ONE] stores every layout value in half-inch increments; 96 CSS px to the
/// inch makes one increment 48 px.
const PX_PER_HALF_INCH: f32 = 48.0;

/// Ink path coordinates arrive in HIMETRIC (0.01 mm) and have to reach the same
/// half-inch space as the layout offsets they are added to. 2540 HIMETRIC to the
/// inch, so 1270 to the half-inch.
const HIMETRIC_PER_HALF_INCH: f32 = 1270.0;

/// [MS-ONE] FontSize is in half-points; 96/72 px to the point.
const PX_PER_HALF_POINT: f32 = 2.0 / 3.0;

/// OneNote wraps math runs in noncharacters (start / argument separator / end).
/// They carry the structure of a `MathInlineObject` tree we do not reconstruct,
/// and render as tofu if left in the text.
const MATH_DELIMITERS: [char; 3] = ['\u{FDD0}', '\u{FDEE}', '\u{FDEF}'];

/// Microsoft Cabinet magic. A `.onepkg` is a CAB; a bare `.one` starts with the
/// [MS-ONESTORE] file-type GUID instead.
const CAB_MAGIC: &[u8; 4] = b"MSCF";

/// Section groups nest, and [MS-ONE] puts no bound on how deeply. A notebook is
/// untrusted input, so cap the recursion rather than risk the stack.
const MAX_GROUP_DEPTH: usize = 32;

const DEFAULT_FONT_PX: f32 = 16.0;
const DEFAULT_TEXT_COLOR: &str = "#1a1a1a";
const DEFAULT_INK_COLOR: &str = "#191c1e";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedNotebook {
    sections: Vec<ImportedSection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSection {
    /// '/'-separated section-group path from the notebook root, empty when the
    /// section sits at the top level. A bare `.one` always yields exactly one
    /// section with an empty path.
    folder_path: String,
    name: String,
    pages: Vec<ImportedPage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPage {
    title: Option<String>,
    /// 1 for a top-level page, higher for subpages of the page above it.
    level: i32,
    elements: Vec<ImportedElement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum ImportedElement {
    Text {
        x: f32,
        y: f32,
        width: Option<f32>,
        text: String,
        font_size: f32,
        font_family: Option<String>,
        color: String,
    },
    Ink {
        strokes: Vec<ImportedStroke>,
    },
    Image {
        x: f32,
        y: f32,
        width: Option<f32>,
        height: Option<f32>,
        /// Base64 of the original bytes; the webview decodes it.
        data: String,
        alt_text: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedStroke {
    /// Flat `[x, y, x, y, ...]` in CSS px, already accumulated and offset.
    points: Vec<f32>,
    color: String,
    size: f32,
}

/// Notebooks run to tens of megabytes, so the bytes arrive as the raw invoke
/// body rather than a JSON number array.
#[tauri::command]
pub async fn parse_onenote(request: Request<'_>) -> Result<ImportedNotebook, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the OneNote file as a raw request body".to_string());
    };
    let bytes = bytes.clone();

    // Parsing a large notebook is CPU-bound; keep it off the async runtime.
    tokio::task::spawn_blocking(move || parse_file(&bytes))
        .await
        .map_err(|e| format!("OneNote parse task panicked: {e}"))?
}

fn parse_file(bytes: &[u8]) -> Result<ImportedNotebook, String> {
    if bytes.starts_with(CAB_MAGIC) {
        parse_package(bytes)
    } else {
        parse_single_section(bytes)
    }
}

fn parse_single_section(bytes: &[u8]) -> Result<ImportedNotebook, String> {
    // The name only ends up in the parser's own error text and section display
    // name; the caller already knows the real file it picked.
    let section = Parser::new()
        .parse_section_buffer(bytes, TypedPath::derive("Section.one"))
        .map_err(|e| format!("could not read OneNote section: {e}"))?;

    Ok(ImportedNotebook {
        sections: vec![convert_section(&section, String::new())],
    })
}

fn parse_package(bytes: &[u8]) -> Result<ImportedNotebook, String> {
    let notebook = Parser::new_with_fs(BufferFs { bytes })
        .parse_package(TypedPath::derive("Notebook.onepkg"))
        .map_err(|e| format!("could not read OneNote package: {e}"))?;

    let mut sections = Vec::new();
    collect_sections(notebook.entries(), "", 0, &mut sections);
    Ok(ImportedNotebook { sections })
}

fn collect_sections(
    entries: &[SectionEntry],
    folder_path: &str,
    depth: usize,
    out: &mut Vec<ImportedSection>,
) {
    if depth > MAX_GROUP_DEPTH {
        return;
    }

    for entry in entries {
        match entry {
            SectionEntry::Section(section) => {
                out.push(convert_section(section, folder_path.to_string()));
            }
            SectionEntry::SectionGroup(group) => {
                let nested = join_path(folder_path, &sanitize_name(group.display_name()));
                collect_sections(group.entries(), &nested, depth + 1, out);
            }
        }
    }
}

fn convert_section(section: &Section, folder_path: String) -> ImportedSection {
    ImportedSection {
        folder_path,
        name: sanitize_name(section.display_name()),
        pages: section
            .page_series()
            .iter()
            .flat_map(|series| series.pages())
            .map(convert_page)
            .collect(),
    }
}

/// Section and group names come from the notebook, so they can hold anything. A
/// separator would forge extra levels in `folder_path`, which the frontend
/// splits on.
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c == '/' || c == '\\' { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn join_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// Serves one in-memory buffer for every path. `parse_package` reads the archive
/// with a single `read_file` and then works entirely from its own in-memory
/// `PackageFs`, so nothing else on this trait is reached during a package parse.
#[derive(Clone, Copy)]
struct BufferFs<'a> {
    bytes: &'a [u8],
}

fn unsupported() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "OneNote packages are parsed from memory, not from a file system",
    )
}

impl FileSystem for BufferFs<'_> {
    fn read_file(&self, _path: TypedPath) -> Result<Vec<u8>, io::Error> {
        Ok(self.bytes.to_vec())
    }

    fn is_directory(&self, _path: TypedPath) -> Result<bool, io::Error> {
        Ok(false)
    }

    fn exists(&self, _path: TypedPath) -> Result<bool, io::Error> {
        Ok(true)
    }

    fn canonicalize(&self, path: TypedPath) -> Result<TypedPathBuf, io::Error> {
        Ok(path.to_path_buf())
    }

    fn read_dir(&self, _path: TypedPath) -> Result<Vec<TypedPathBuf>, io::Error> {
        Err(unsupported())
    }

    fn write_file(&self, _path: TypedPath, _data: &[u8]) -> Result<(), io::Error> {
        Err(unsupported())
    }

    fn stream_to_file(&self, _path: TypedPath, _reader: &mut dyn io::Read) -> Result<(), io::Error> {
        Err(unsupported())
    }

    fn make_dir(&self, _path: TypedPath) -> Result<(), io::Error> {
        Err(unsupported())
    }
}

fn convert_page(page: &Page) -> ImportedPage {
    let mut elements = Vec::new();
    for content in page.contents() {
        match content {
            PageContent::Outline(outline) => push_outline(outline, &mut elements),
            PageContent::Image(image) => push_image(image, (0.0, 0.0), &mut elements),
            PageContent::Ink(ink) => push_ink(ink, &mut elements),
            // Attachments have no canvas representation yet; the page still imports.
            _ => {}
        }
    }

    ImportedPage {
        title: page.title_text().map(str::to_string),
        level: page.level(),
        elements,
    }
}

#[derive(Clone)]
struct TextStyle {
    font_size: f32,
    font_family: Option<String>,
    color: String,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font_size: DEFAULT_FONT_PX,
            font_family: None,
            color: DEFAULT_TEXT_COLOR.to_string(),
        }
    }
}

/// An outline becomes a single text box: OneNote positions the outline but lets
/// its elements flow inside it, so there are no per-paragraph coordinates to
/// place them by. Nesting depth becomes tab indentation instead.
fn push_outline(outline: &Outline, out: &mut Vec<ImportedElement>) {
    let origin = (
        outline.offset_horizontal().unwrap_or(0.0),
        outline.offset_vertical().unwrap_or(0.0),
    );
    let mut lines = Vec::new();
    let mut style = None;
    collect_outline_items(outline.items(), origin, 0, &mut lines, &mut style, out);

    let text = lines.join("\n").trim_end().to_string();
    if text.is_empty() {
        return;
    }

    let style = style.unwrap_or_default();
    out.push(ImportedElement::Text {
        x: half_inches_to_px(origin.0),
        y: half_inches_to_px(origin.1),
        width: outline.layout_max_width().map(half_inches_to_px),
        text,
        font_size: style.font_size,
        font_family: style.font_family,
        color: style.color,
    });
}

fn collect_outline_items(
    items: &[OutlineItem],
    // Fallback placement, in half-inch increments, for content that flows inside
    // the outline instead of carrying offsets of its own.
    origin: (f32, f32),
    depth: usize,
    lines: &mut Vec<String>,
    style: &mut Option<TextStyle>,
    out: &mut Vec<ImportedElement>,
) {
    for item in items {
        match item {
            OutlineItem::Group(group) => {
                collect_outline_items(group.outlines(), origin, depth, lines, style, out);
            }
            OutlineItem::Element(element) => {
                for content in element.contents() {
                    match content {
                        Content::RichText(text) => {
                            if style.is_none() {
                                *style = Some(text_style(text));
                            }
                            push_text_lines(text, depth, lines);
                            // Ink drawn inside a paragraph still carries absolute
                            // page coordinates, so it becomes its own element.
                            for embedded in text.embedded_objects() {
                                if let EmbeddedObject::Ink(container) = embedded {
                                    push_ink(container.ink(), out);
                                }
                            }
                        }
                        Content::Table(table) => push_table_lines(table, depth, lines),
                        Content::Image(image) => push_image(image, origin, out),
                        Content::Ink(ink) => push_ink(ink, out),
                        _ => {}
                    }
                }
                collect_outline_items(element.children(), origin, depth + 1, lines, style, out);
            }
        }
    }
}

fn push_text_lines(text: &RichText, depth: usize, lines: &mut Vec<String>) {
    let indent = "\t".repeat(depth);
    for line in clean_text(text.text()).split('\n') {
        lines.push(format!("{indent}{line}"));
    }
}

/// Tables flatten to tab-separated rows: the canvas text box has no table cell
/// of its own, and dropping them would lose the content entirely.
fn push_table_lines(table: &Table, depth: usize, lines: &mut Vec<String>) {
    let indent = "\t".repeat(depth);
    for row in table.contents() {
        let cells: Vec<String> = row
            .contents()
            .iter()
            .map(|cell| {
                let mut cell_lines = Vec::new();
                let mut cell_style = None;
                let mut cell_elements = Vec::new();
                for element in cell.contents() {
                    for content in element.contents() {
                        if let Content::RichText(text) = content {
                            if cell_style.is_none() {
                                cell_style = Some(text_style(text));
                            }
                            push_text_lines(text, 0, &mut cell_lines);
                        }
                    }
                    collect_outline_items(
                        element.children(),
                        (0.0, 0.0),
                        0,
                        &mut cell_lines,
                        &mut cell_style,
                        &mut cell_elements,
                    );
                }
                cell_lines.join(" ").trim().to_string()
            })
            .collect();
        lines.push(format!("{indent}{}", cells.join("\t")));
    }
}

fn text_style(text: &RichText) -> TextStyle {
    let style = text.paragraph_style();
    TextStyle {
        font_size: style
            .font_size()
            .map(|size| size as f32 * PX_PER_HALF_POINT)
            .unwrap_or(DEFAULT_FONT_PX),
        font_family: style.font().map(str::to_string),
        color: style
            .font_color()
            .and_then(color_ref_to_hex)
            .unwrap_or_else(|| DEFAULT_TEXT_COLOR.to_string()),
    }
}

fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| !MATH_DELIMITERS.contains(c))
        .collect()
}

fn push_image(image: &Image, origin: (f32, f32), out: &mut Vec<ImportedElement>) {
    let Some(mut reader) = image.read() else {
        return;
    };
    let mut bytes = Vec::new();
    if std::io::Read::read_to_end(&mut reader, &mut bytes).is_err() || bytes.is_empty() {
        return;
    }

    out.push(ImportedElement::Image {
        x: half_inches_to_px(image.offset_horizontal().unwrap_or(origin.0)),
        y: half_inches_to_px(image.offset_vertical().unwrap_or(origin.1)),
        width: image.layout_max_width().map(half_inches_to_px),
        height: image.layout_max_height().map(half_inches_to_px),
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        alt_text: image.alt_text().map(str::to_string),
    });
}

fn push_ink(ink: &Ink, out: &mut Vec<ImportedElement>) {
    let mut strokes = Vec::new();
    collect_strokes(ink, &mut strokes);
    if !strokes.is_empty() {
        out.push(ImportedElement::Ink { strokes });
    }
}

fn collect_strokes(ink: &Ink, out: &mut Vec<ImportedStroke>) {
    let offset_x = ink.offset_horizontal().unwrap_or(0.0);
    let offset_y = ink.offset_vertical().unwrap_or(0.0);

    for stroke in ink.ink_strokes() {
        let path = stroke.path();
        if path.is_empty() {
            continue;
        }

        out.push(ImportedStroke {
            points: accumulate_path(
                path.iter().map(|point| (point.x(), point.y())),
                offset_x,
                offset_y,
            ),
            color: stroke
                .color()
                .map(colorref_u32_to_hex)
                .unwrap_or_else(|| DEFAULT_INK_COLOR.to_string()),
            size: half_inches_to_px(stroke.width() / HIMETRIC_PER_HALF_INCH),
        });
    }

    for group in ink.child_groups() {
        collect_strokes(group, out);
    }
}

/// The parser hands back the raw decoded ISF stream: the first value of a path
/// is the absolute start and every later value is a delta from the point before
/// it. Nothing upstream accumulates them. `offset` is the ink container's own
/// placement, already in half-inch increments.
fn accumulate_path(
    path: impl Iterator<Item = (f32, f32)>,
    offset_x: f32,
    offset_y: f32,
) -> Vec<f32> {
    let (mut x, mut y) = (0.0f32, 0.0f32);
    let mut points = Vec::new();
    for (dx, dy) in path {
        x += dx;
        y += dy;
        points.push(half_inches_to_px(x / HIMETRIC_PER_HALF_INCH + offset_x));
        points.push(half_inches_to_px(y / HIMETRIC_PER_HALF_INCH + offset_y));
    }
    points
}

fn half_inches_to_px(value: f32) -> f32 {
    value * PX_PER_HALF_INCH
}

fn color_ref_to_hex(color: ColorRef) -> Option<String> {
    match color {
        ColorRef::Auto => None,
        ColorRef::Manual { r, g, b } => Some(format!("#{r:02x}{g:02x}{b:02x}")),
    }
}

/// Ink stroke colors arrive as a raw COLORREF (0x00BBGGRR).
fn colorref_u32_to_hex(value: u32) -> String {
    let [r, g, b, _] = value.to_le_bytes();
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulates_deltas_onto_the_absolute_first_point() {
        // 1270 HIMETRIC is one half-inch, which is 48 px.
        let path = [(1270.0, 2540.0), (1270.0, 0.0), (0.0, -1270.0)];
        let points = accumulate_path(path.into_iter(), 0.0, 0.0);
        assert_eq!(points, vec![48.0, 96.0, 96.0, 96.0, 96.0, 48.0]);
    }

    #[test]
    fn container_offset_shifts_the_whole_path() {
        let path = [(1270.0, 1270.0)];
        let points = accumulate_path(path.into_iter(), 2.0, -1.0);
        assert_eq!(points, vec![(1.0 + 2.0) * 48.0, (1.0 - 1.0) * 48.0]);
    }

    #[test]
    fn strips_math_delimiters_but_keeps_the_expression() {
        assert_eq!(clean_text("a\u{FDD0}b\u{FDEE}c\u{FDEF}d"), "abcd");
        assert_eq!(clean_text("plain text"), "plain text");
    }

    #[test]
    fn decodes_colorref_byte_order() {
        // 0x00BBGGRR: red channel is the low byte.
        assert_eq!(colorref_u32_to_hex(0x0000_00FF), "#ff0000");
        assert_eq!(colorref_u32_to_hex(0x00FF_0000), "#0000ff");
        // 0x008B4F00, a pen color taken from a real section file.
        assert_eq!(colorref_u32_to_hex(9_129_728), "#004f8b");
    }

    #[test]
    fn auto_color_falls_back_to_the_canvas_default() {
        assert_eq!(color_ref_to_hex(ColorRef::Auto), None);
        assert_eq!(
            color_ref_to_hex(ColorRef::Manual { r: 1, g: 2, b: 3 }),
            Some("#010203".to_string())
        );
    }

    #[test]
    fn converts_half_points_to_pixels() {
        // 22 half-points is 11pt, which is 14.67 px at 96 dpi.
        assert!((22.0 * PX_PER_HALF_POINT - 14.666_667).abs() < 0.001);
    }
}
