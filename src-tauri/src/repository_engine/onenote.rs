use super::{document, store, Changes, Store};
use crate::onenote_import::{ImportedElement, ImportedNotebook, ImportedPage};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::ipc::Channel;
use yrs::{Any, Array, ArrayRef, Doc, Map, MapPrelim, Transact, TransactionMut};

/// `payload` is set directly because stroke points and image bytes are too large for the JSON
/// round trip `props` takes: 12M points spent most of an import there.
fn push_element(
    txn: &mut TransactionMut,
    elements: &ArrayRef,
    kind: u8,
    props: Value,
    payload: Option<(&str, Any)>,
) {
    let element = elements.insert(txn, 0, MapPrelim::default());
    element.insert(txn, "type", kind as i64);
    element.insert(txn, "uuid", uuid::Uuid::new_v4().to_string());
    if let Any::Map(props) = Any::from_json(&props.to_string()).unwrap() {
        for (key, value) in props.iter() {
            element.insert(txn, key.as_str(), value.clone());
        }
    }
    if let Some((key, value)) = payload {
        element.insert(txn, key, value);
    }
}

fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(std::io::Cursor::new(data))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

fn page_document(page: ImportedPage) -> Doc {
    let doc = Doc::new();
    let elements = doc.get_or_insert_array("elements");
    push_page(&mut doc.transact_mut(), &elements, page);
    doc
}

// Builds the page back to front, inserting at the head: yrs walks the list from the head on every
// insert, so `push_back` is quadratic in a page's strokes.
fn push_page(txn: &mut TransactionMut, elements: &ArrayRef, page: ImportedPage) {
    for element in page.elements.into_iter().rev() {
        match element {
            ImportedElement::Text {
                x,
                y,
                width,
                text,
                font_size,
                font_family,
                color,
            } => {
                push_element(
                    txn,
                    elements,
                    1,
                    json!({
                        "offsetX": x + 160.0, "offsetY": y + 80.0, "scaleX": 1, "scaleY": 1,
                        "text": text, "color": color, "fontSize": font_size,
                        "fontFamily": font_family.unwrap_or_else(|| "sans-serif".into()),
                        "boxWidth": width.unwrap_or(400.0), "boxHeight": 0
                    }),
                    None,
                );
            }
            ImportedElement::Ink { strokes } => {
                for stroke in strokes.into_iter().rev() {
                    // The parser drops pressure; zero placeholders keep the editor's [x, y, pressure] format.
                    let points: Vec<Any> = stroke
                        .points
                        .chunks_exact(2)
                        .flat_map(|point| [point[0] + 160.0, point[1] + 80.0, 0.0])
                        .map(|value| {
                            if value.is_finite() {
                                Any::Number(value as f64)
                            } else {
                                Any::Null
                            }
                        })
                        .collect();
                    let mut props = json!({
                        "offsetX": 0, "offsetY": 0, "scaleX": 1, "scaleY": 1,
                        "color": stroke.color, "size": stroke.size, "hasPressure": false
                    });
                    if stroke.highlighter {
                        props["simulatePressure"] = json!(false);
                    }
                    push_element(
                        txn,
                        elements,
                        0,
                        props,
                        Some(("points", Any::Array(points.into()))),
                    );
                }
            }
            ImportedElement::Image {
                x,
                y,
                width,
                height,
                data,
            } => {
                let Some((natural_width, natural_height)) = image_dimensions(&data) else {
                    continue;
                };
                push_element(
                    txn,
                    elements,
                    2,
                    json!({
                        "offsetX": x + 160.0, "offsetY": y + 80.0,
                        "scaleX": width.filter(|width| *width != 0.0).unwrap_or(natural_width as f32) / natural_width as f32,
                        "scaleY": height.filter(|height| *height != 0.0).unwrap_or(natural_height as f32) / natural_height as f32,
                        "naturalWidth": natural_width, "naturalHeight": natural_height,
                        "cropX": 0, "cropY": 0, "cropW": natural_width, "cropH": natural_height
                    }),
                    Some(("imageData", Any::Buffer(data.into()))),
                );
            }
        }
    }
}

fn add_node(
    state: &mut Store,
    name: String,
    parent_id: Option<String>,
    file: bool,
    changes: &mut Changes,
) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = store::now();
    let mut node = json!({"id": id, "name": name, "parentId": parent_id,
        "type": if file { "file" } else { "folder" }, "tags": [], "createdAt": now, "modifiedAt": now});
    if file {
        node["fileType"] = json!("mcanvas");
    }
    state.manifest["nodes"][&id] = node;
    state.queue("upsert-manifest-node", Some(&id), json!({}));
    if file {
        state.queue("push-note", Some(&id), json!({"baseFileRevision": null}));
    }
    changes.changed.push(id.clone());
    id
}

pub(super) fn import(
    state: &mut Store,
    notebook: ImportedNotebook,
    parent_id: Option<String>,
    root_name: String,
    fallback_title: &str,
    progress: &Channel<Value>,
) -> Result<(Value, Changes), String> {
    if parent_id
        .as_ref()
        .is_some_and(|id| state.manifest["nodes"][id]["type"] != "folder")
    {
        return Err("Import destination is not a folder".into());
    }
    state.transaction_active = true;
    let mut changes = Changes {
        wake_remote: state.remote,
        ..Changes::default()
    };
    let root_id = add_node(state, root_name, parent_id, false, &mut changes);
    let flat = notebook.sections.len() == 1 && notebook.sections[0].folder_path.is_empty();
    let total: usize = notebook
        .sections
        .iter()
        .map(|section| section.pages.len())
        .sum();
    let mut folders = HashMap::new();
    let mut written = Vec::new();
    let mut imported = 0;
    for section in notebook.sections {
        let mut parent = root_id.clone();
        if !flat {
            let path = if section.folder_path.is_empty() {
                section.name
            } else {
                format!("{}/{}", section.folder_path, section.name)
            };
            let mut prefix = String::new();
            for name in path.split('/') {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(name);
                parent = folders
                    .entry(prefix.clone())
                    .or_insert_with(|| {
                        add_node(
                            state,
                            name.into(),
                            Some(parent.clone()),
                            false,
                            &mut changes,
                        )
                    })
                    .clone();
            }
        }
        for (index, page) in section.pages.into_iter().enumerate() {
            let title = page
                .title
                .as_deref()
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{fallback_title} {}", index + 1));
            let mut name = title.clone();
            let mut suffix = 1;
            while state.manifest["nodes"]
                .as_object()
                .unwrap()
                .values()
                .any(|node| {
                    node["parentId"] == parent && node["name"] == name && node["system"].is_null()
                })
            {
                name = format!("{title} {suffix}");
                suffix += 1;
            }
            let doc = page_document(page);
            let id = add_node(state, name, Some(parent.clone()), true, &mut changes);
            // Skips the journal, which would base64 the whole notebook into one JSON file and write
            // it twice. These IDs are new, so a file is unreachable until the commit below adds its
            // node, and a crash before then leaves only an inert orphan.
            let path = state
                .root
                .join("files")
                .join(store::file_name(&state.manifest["nodes"][&id])?);
            if let Err(error) = store::atomic_write(&path, &document::bytes(&doc)) {
                for path in written {
                    let _ = std::fs::remove_file(path);
                }
                return Err(error);
            }
            written.push(path);
            state
                .sync
                .document_generations
                .insert(id, uuid::Uuid::new_v4().to_string());
            imported += 1;
            let _ = progress.send(json!({"current": imported, "total": total, "fileName": title}));
        }
    }
    state.commit(Vec::new())?;
    Ok((
        json!({"rootFolderId": root_id, "pagesImported": imported, "skippedPages": 0}),
        changes,
    ))
}
