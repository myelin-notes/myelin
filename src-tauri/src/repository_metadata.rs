use crate::repository_bootstrap::{reject_symlink, valid_component};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

pub(crate) const SETTINGS: &str = "repository.json";
pub(crate) mod legacy;
pub(crate) use legacy::{BACKUP, MARKER};
pub(crate) const SUFFIX: &str = ".meta.json";

pub(crate) fn empty_manifest() -> Value {
    json!({ "version": 3, "nodes": {}, "linksBySource": {}, "colors": { "pen": [], "highlighter": [], "text": [], "folder": [] }, "tagRegistry": [], "penPresets": [] })
}

pub(crate) fn is_marker(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes).is_ok_and(|value| value["version"] == 4)
}

pub(crate) fn is_metadata_path(path: &str) -> bool {
    path.strip_prefix("files/")
        .and_then(|name| name.strip_suffix(SUFFIX))
        .is_some_and(valid_component)
}

pub(crate) fn settings(manifest: &Value) -> Result<Vec<u8>, String> {
    let object = manifest.as_object().ok_or("Invalid repository metadata")?;
    let mut settings = Value::Object(
        object
            .iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "nodes" | "linksBySource" | "deletedNodes" | "restoredNodes"
                )
            })
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    );
    settings["version"] = json!(1);
    serde_json::to_vec(&settings).map_err(|e| e.to_string())
}

pub(crate) fn node_record(manifest: &Value, id: &str) -> Result<Vec<u8>, String> {
    if !valid_component(id) {
        return Err("Invalid repository node ID".into());
    }
    let node = &manifest["nodes"][id];
    let record = if node.is_null() {
        let deletion = &manifest["deletedNodes"][id];
        if !deletion.is_string() {
            return Err("Invalid deletion revision".into());
        }
        json!({"version":1,"id":id,"deleted":true,"deletionId":deletion})
    } else {
        validate_node(id, node)?;
        let links = manifest["linksBySource"][id]
            .as_array()
            .cloned()
            .unwrap_or_default();
        json!({"version":1,"node":node,"links":links,"restoredFrom":manifest["restoredNodes"][id]})
    };
    serde_json::to_vec(&record).map_err(|e| e.to_string())
}

pub(crate) fn changed_nodes(previous: &Value, next: &Value) -> HashSet<String> {
    let mut changed = HashSet::new();
    for key in ["nodes", "linksBySource", "deletedNodes", "restoredNodes"] {
        for id in previous[key]
            .as_object()
            .into_iter()
            .flat_map(|nodes| nodes.keys())
            .chain(
                next[key]
                    .as_object()
                    .into_iter()
                    .flat_map(|nodes| nodes.keys()),
            )
        {
            if previous[key][id] != next[key][id] {
                changed.insert(id.clone());
            }
        }
    }
    changed
}

pub(crate) fn records(manifest: &Value) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut records = HashMap::from([(SETTINGS.into(), settings(manifest)?)]);
    let nodes = manifest["nodes"]
        .as_object()
        .ok_or("Invalid repository nodes")?;
    let ids: HashSet<_> = nodes
        .keys()
        .chain(
            manifest["deletedNodes"]
                .as_object()
                .into_iter()
                .flat_map(|nodes| nodes.keys()),
        )
        .collect();
    for id in ids {
        records.insert(format!("files/{id}{SUFFIX}"), node_record(manifest, id)?);
    }
    Ok(records)
}

pub(crate) fn validate_node(id: &str, node: &Value) -> Result<(), String> {
    if !valid_component(id)
        || node["id"] != id
        || !matches!(node["type"].as_str(), Some("file" | "folder"))
        || !node["name"].is_string()
        || !node["tags"]
            .as_array()
            .is_some_and(|tags| tags.iter().all(Value::is_string))
        || !node["createdAt"].is_number()
        || !node["modifiedAt"].is_number()
        || !(node["parentId"].is_null() || node["parentId"].as_str().is_some_and(valid_component))
        || (node["type"] == "file"
            && !node["fileType"]
                .as_str()
                .is_some_and(|kind| valid_component(kind) && kind != "meta.json"))
    {
        return Err(format!("Invalid metadata for node {id}"));
    }
    Ok(())
}

pub(crate) fn assemble(records: &HashMap<String, Vec<u8>>) -> Result<Value, String> {
    let mut manifest = match records.get(SETTINGS) {
        Some(bytes) => {
            let settings: Value =
                serde_json::from_slice(bytes).map_err(|_| "Unreadable repository settings")?;
            if settings["version"] != 1 {
                return Err("Unsupported repository settings version".into());
            }
            settings
        }
        None => empty_manifest(),
    };
    if !manifest.is_object() {
        return Err("Invalid repository settings".into());
    }
    manifest["version"] = json!(3);
    manifest["nodes"] = json!({});
    manifest["linksBySource"] = json!({});
    manifest["deletedNodes"] = json!({});
    manifest["restoredNodes"] = json!({});
    for (path, bytes) in records {
        if path == SETTINGS {
            continue;
        }
        let id = path
            .strip_prefix("files/")
            .and_then(|name| name.strip_suffix(SUFFIX))
            .filter(|id| valid_component(id))
            .ok_or("Invalid metadata path")?;
        let record: Value = serde_json::from_slice(bytes)
            .map_err(|_| format!("Unreadable metadata for node {id}"))?;
        if record["version"] != 1 {
            return Err(format!("Unsupported metadata version for node {id}"));
        }
        if record["deleted"] == true {
            if record["id"] != id {
                return Err("Invalid deleted node ID".into());
            }
            if !record["deletionId"].is_string() {
                return Err("Invalid deletion revision".into());
            }
            manifest["deletedNodes"][id] = record["deletionId"].clone();
        } else {
            validate_node(id, &record["node"])?;
            if !record["links"].is_array() {
                return Err("Invalid stored note links".into());
            }
            manifest["nodes"][id] = record["node"].clone();
            if !record["restoredFrom"].is_null() {
                manifest["restoredNodes"][id] = record["restoredFrom"].clone();
            }
            if !record["links"].as_array().unwrap().is_empty() {
                manifest["linksBySource"][id] = record["links"].clone();
            }
        }
    }
    normalize(&mut manifest);
    let mut detached = Vec::new();
    for id in manifest["nodes"].as_object().unwrap().keys() {
        let mut visited = HashSet::from([id.as_str()]);
        let mut node = &manifest["nodes"][id];
        while let Some(parent) = node["parentId"].as_str() {
            node = &manifest["nodes"][parent];
            if node["type"] != "folder" || !visited.insert(parent) {
                detached.push(id.clone());
                break;
            }
        }
    }
    for id in detached {
        manifest["nodes"][id]["parentId"] = Value::Null;
    }
    Ok(manifest)
}

pub(crate) struct Loaded {
    pub manifest: Value,
    pub records: HashMap<String, Vec<u8>>,
    pub legacy: Option<Vec<u8>>,
    pub corrupt: Vec<String>,
}

pub(crate) fn load(root: &Path) -> Result<Loaded, String> {
    reject_symlink(&root.join("manifest.json"))?;
    let legacy = match fs::read(root.join("manifest.json")) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if let Some(bytes) = &legacy {
        if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
            if value["version"].as_u64().is_some_and(|version| version > 4) {
                return Err(
                    "Unsupported repository storage version; update Myelin before opening".into(),
                );
            }
        }
    }
    if let Some(bytes) = legacy.as_ref().filter(|bytes| !is_marker(bytes)) {
        // The old manifest remains authoritative until the final migration marker is written.
        if let Ok(mut manifest) = legacy::parse_manifest(bytes) {
            legacy::migrate(&mut manifest);
            records(&manifest)?;
            return Ok(Loaded {
                manifest,
                records: HashMap::new(),
                legacy,
                corrupt: Vec::new(),
            });
        }
    }
    let mut records = HashMap::new();
    let mut corrupt = Vec::new();
    reject_symlink(&root.join(SETTINGS))?;
    match fs::read(root.join(SETTINGS)) {
        Ok(bytes) => {
            if assemble(&HashMap::from([(SETTINGS.into(), bytes.clone())])).is_ok() {
                records.insert(SETTINGS.into(), bytes);
            } else {
                corrupt.push(SETTINGS.into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    reject_symlink(&root.join("files"))?;
    if root.join("files").exists() {
        for entry in fs::read_dir(root.join("files")).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(SUFFIX) {
                continue;
            }
            reject_symlink(&entry.path())?;
            let path = format!("files/{name}");
            let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
            if assemble(&HashMap::from([(path.clone(), bytes.clone())])).is_ok() {
                records.insert(path, bytes);
            } else {
                corrupt.push(path);
            }
        }
    }
    if legacy.as_ref().is_some_and(|bytes| !is_marker(bytes))
        && records.is_empty()
        && corrupt.is_empty()
    {
        return Err("Unreadable repository manifest; migration requires recovery".into());
    }
    if !records.contains_key(SETTINGS)
        && !corrupt.iter().any(|path| path == SETTINGS)
        && (legacy.as_ref().is_some_and(|bytes| is_marker(bytes)) || !records.is_empty())
    {
        corrupt.push(SETTINGS.into());
    }
    let manifest = assemble(&records)?;
    Ok(Loaded {
        manifest,
        records,
        legacy: None,
        corrupt,
    })
}

pub(crate) fn normalize(manifest: &mut Value) {
    manifest["version"] = json!(3);
    for key in ["linksBySource", "colors"] {
        if !manifest[key].is_object() {
            manifest[key] = json!({});
        }
    }
    for key in ["pen", "highlighter", "text", "folder"] {
        if !manifest["colors"][key].is_array() {
            manifest["colors"][key] = json!([]);
        }
    }
    if !manifest["tagRegistry"].is_array() {
        manifest["tagRegistry"] = json!([]);
    }
    let presets = manifest["penPresets"].as_array().map(|entries| entries.iter().filter_map(|entry| {
        let (min, max) = match entry["tool"].as_str()? { "pen" => (1.0, 40.0), "highlighter" => (12.0, 60.0), _ => return None };
        let color = entry["color"].as_str()?.trim();
        let color = color.strip_prefix('#').unwrap_or(color);
        if color.len() != 6 || !color.bytes().all(|byte| byte.is_ascii_hexdigit()) || !entry["id"].is_string() { return None; }
        Some(json!({"id": entry["id"], "tool": entry["tool"], "color": format!("#{}", color.to_lowercase()), "size": entry["size"].as_f64()?.clamp(min, max), "inWheel": entry["inWheel"] == true}))
    }).take(6).collect::<Vec<_>>()).unwrap_or_default();
    manifest["penPresets"] = json!(presets);
}
