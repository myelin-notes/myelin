use super::{document, store, Changes, FileWrite, Store, STANDARD};
use crate::onenote_import::{ImportedElement, ImportedNotebook, ImportedPage};
use base64::Engine as _;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::ipc::Channel;
use yrs::{Any, Array, Doc, Map, MapPrelim, Transact};

fn push_element(doc: &Doc, kind: u8, props: Value, image: Option<Vec<u8>>) {
    let elements = doc.get_or_insert_array("elements");
    let mut txn = doc.transact_mut();
    let element = elements.push_back(&mut txn, MapPrelim::default());
    element.insert(&mut txn, "type", kind as i64);
    element.insert(&mut txn, "uuid", uuid::Uuid::new_v4().to_string());
    if let Any::Map(props) = Any::from_json(&props.to_string()).unwrap() {
        for (key, value) in props.iter() {
            element.insert(&mut txn, key.as_str(), value.clone());
        }
    }
    if let Some(bytes) = image {
        element.insert(&mut txn, "imageData", Any::Buffer(bytes.into()));
    }
}

fn page_document(page: ImportedPage) -> Doc {
    let doc = Doc::new();
    for element in page.elements {
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
                    &doc,
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
                for stroke in strokes {
                    // The parser drops pressure; zero placeholders keep the editor's [x, y, pressure] format.
                    let points: Vec<f32> = stroke
                        .points
                        .chunks_exact(2)
                        .flat_map(|point| [point[0] + 160.0, point[1] + 80.0, 0.0])
                        .collect();
                    push_element(
                        &doc,
                        0,
                        json!({
                            "offsetX": 0, "offsetY": 0, "scaleX": 1, "scaleY": 1,
                            "color": stroke.color, "size": stroke.size, "hasPressure": false,
                            "points": points
                        }),
                        None,
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
                let Ok(bitmap) = image::load_from_memory(&data) else {
                    continue;
                };
                let (natural_width, natural_height) = (bitmap.width(), bitmap.height());
                push_element(
                    &doc,
                    2,
                    json!({
                        "offsetX": x + 160.0, "offsetY": y + 80.0,
                        "scaleX": width.filter(|width| *width != 0.0).unwrap_or(natural_width as f32) / natural_width as f32,
                        "scaleY": height.filter(|height| *height != 0.0).unwrap_or(natural_height as f32) / natural_height as f32,
                        "naturalWidth": natural_width, "naturalHeight": natural_height,
                        "cropX": 0, "cropY": 0, "cropW": natural_width, "cropH": natural_height
                    }),
                    Some(data),
                );
            }
        }
    }
    doc
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
    let mut files = Vec::new();
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
            files.push(FileWrite {
                name: store::file_name(&state.manifest["nodes"][&id])?,
                bytes: Some(STANDARD.encode(document::bytes(&doc))),
            });
            state
                .sync
                .document_generations
                .insert(id, uuid::Uuid::new_v4().to_string());
            imported += 1;
            let _ = progress.send(json!({"current": imported, "total": total, "fileName": title}));
        }
    }
    state.commit(files)?;
    Ok((
        json!({"rootFolderId": root_id, "pagesImported": imported, "skippedPages": 0}),
        changes,
    ))
}
