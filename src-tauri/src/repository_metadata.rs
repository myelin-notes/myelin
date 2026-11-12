use crate::repository_bootstrap::{reject_symlink, valid_component};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
};

pub(crate) const SETTINGS: &str = "repository.json";
// Omitting nodes makes older clients reject sidecar repositories before writing.
pub(crate) const MARKER: &[u8] = br#"{"version":4}"#;
pub(crate) const SUFFIX: &str = ".meta.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NodeKind {
    File,
    Folder,
}

// Persisted through `json!`, whose map sorts keys, so field order here never reaches disk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Node {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: NodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub tags: Vec<String>,
    pub created_at: Number,
    pub modified_at: Number,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Node {
    pub fn is_file(&self) -> bool {
        self.kind == NodeKind::File
    }

    pub fn is_folder(&self) -> bool {
        self.kind == NodeKind::Folder
    }

    pub fn system_kind(&self) -> Option<&str> {
        self.system.as_ref()?["kind"].as_str()
    }

    pub fn is_media(&self) -> bool {
        self.system_kind() == Some("media")
    }

    pub fn is_canvas(&self) -> bool {
        self.file_type.as_deref() == Some("mcanvas")
    }

    pub fn validate(&self, id: &str) -> Result<(), String> {
        let valid_file_type = match (self.kind, self.file_type.as_deref()) {
            (NodeKind::File, Some(kind)) => valid_component(kind) && kind != "meta.json",
            (NodeKind::File, None) => false,
            (NodeKind::Folder, _) => true,
        };
        if !valid_component(id)
            || self.id != id
            || !valid_file_type
            || !self
                .parent_id
                .as_deref()
                .is_none_or(|parent| valid_component(parent))
        {
            return Err(format!("Invalid metadata for node {id}"));
        }
        Ok(())
    }
}

pub(crate) fn parse_node(id: &str, value: Value) -> Result<Node, String> {
    let node: Node =
        serde_json::from_value(value).map_err(|_| format!("Invalid metadata for node {id}"))?;
    node.validate(id)?;
    Ok(node)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Manifest {
    pub version: u64,
    #[serde(default)]
    pub nodes: BTreeMap<String, Node>,
    #[serde(default)]
    pub links_by_source: BTreeMap<String, Vec<Value>>,
    #[serde(default)]
    pub deleted_nodes: BTreeMap<String, String>,
    #[serde(default)]
    pub restored_nodes: BTreeMap<String, String>,
    #[serde(default)]
    pub colors: Value,
    #[serde(default)]
    pub tag_registry: Value,
    #[serde(default)]
    pub pen_presets: Value,
    #[serde(default)]
    pub flag_types: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Manifest {
    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id)
    }

    pub fn node_mut(&mut self, id: &str) -> Option<&mut Node> {
        self.nodes.get_mut(id)
    }

    pub fn file(&self, id: &str) -> Option<&Node> {
        self.nodes.get(id).filter(|node| node.is_file())
    }

    pub fn is_deleted(&self, id: &str) -> bool {
        self.deleted_nodes.contains_key(id)
    }

    /// Reinstates `id` from the tombstone it was deleted under, so other devices accept it.
    pub fn restore(&mut self, id: &str, node: Node) {
        if let Some(deletion) = self.deleted_nodes.remove(id) {
            self.restored_nodes.insert(id.into(), deletion);
        }
        self.nodes.insert(id.into(), node);
    }

    pub fn remove_links(&mut self, id: &str) {
        self.links_by_source.remove(id);
    }
}

pub(crate) fn empty_manifest() -> Manifest {
    Manifest {
        version: 3,
        nodes: BTreeMap::new(),
        links_by_source: BTreeMap::new(),
        deleted_nodes: BTreeMap::new(),
        restored_nodes: BTreeMap::new(),
        colors: json!({ "pen": [], "highlighter": [], "text": [], "folder": [] }),
        tag_registry: json!([]),
        pen_presets: json!([]),
        flag_types: json!([]),
        live_secret: None,
        generation: None,
        extra: Map::new(),
    }
}

pub(crate) fn is_marker(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Value>(bytes).is_ok_and(|value| value["version"] == 4)
}

pub(crate) fn is_metadata_path(path: &str) -> bool {
    path.strip_prefix("files/")
        .and_then(|name| name.strip_suffix(SUFFIX))
        .is_some_and(valid_component)
}

pub(crate) fn settings(manifest: &Manifest) -> Result<Vec<u8>, String> {
    let mut settings = serde_json::to_value(manifest).map_err(|e| e.to_string())?;
    let object = settings
        .as_object_mut()
        .ok_or("Invalid repository metadata")?;
    for key in ["nodes", "linksBySource", "deletedNodes", "restoredNodes"] {
        object.remove(key);
    }
    settings["version"] = json!(1);
    serde_json::to_vec(&settings).map_err(|e| e.to_string())
}

pub(crate) fn node_record(manifest: &Manifest, id: &str) -> Result<Vec<u8>, String> {
    if !valid_component(id) {
        return Err("Invalid repository node ID".into());
    }
    let record = match manifest.nodes.get(id) {
        None => {
            let deletion = manifest
                .deleted_nodes
                .get(id)
                .ok_or("Invalid deletion revision")?;
            json!({"version":1,"id":id,"deleted":true,"deletionId":deletion})
        }
        Some(node) => {
            node.validate(id)?;
            let links = manifest
                .links_by_source
                .get(id)
                .cloned()
                .unwrap_or_default();
            json!({"version":1,"node":node,"links":links,"restoredFrom":manifest.restored_nodes.get(id)})
        }
    };
    serde_json::to_vec(&record).map_err(|e| e.to_string())
}

pub(crate) fn changed_nodes(previous: &Manifest, next: &Manifest) -> HashSet<String> {
    fn differing<'a, T: PartialEq>(
        previous: &'a BTreeMap<String, T>,
        next: &'a BTreeMap<String, T>,
    ) -> impl Iterator<Item = &'a String> {
        previous
            .keys()
            .chain(next.keys())
            .filter(move |id| previous.get(*id) != next.get(*id))
    }
    differing(&previous.nodes, &next.nodes)
        .chain(differing(&previous.links_by_source, &next.links_by_source))
        .chain(differing(&previous.deleted_nodes, &next.deleted_nodes))
        .chain(differing(&previous.restored_nodes, &next.restored_nodes))
        .cloned()
        .collect()
}

pub(crate) fn records(manifest: &Manifest) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut records = HashMap::from([(SETTINGS.into(), settings(manifest)?)]);
    for id in manifest
        .nodes
        .keys()
        .chain(manifest.deleted_nodes.keys())
        .collect::<HashSet<_>>()
    {
        records.insert(format!("files/{id}{SUFFIX}"), node_record(manifest, id)?);
    }
    Ok(records)
}

pub(crate) fn assemble(records: &HashMap<String, Vec<u8>>) -> Result<Manifest, String> {
    let mut manifest = match records.get(SETTINGS) {
        Some(bytes) => {
            let settings: Value =
                serde_json::from_slice(bytes).map_err(|_| "Unreadable repository settings")?;
            if settings["version"] != 1 {
                return Err("Unsupported repository settings version".into());
            }
            serde_json::from_value::<Manifest>(settings)
                .map_err(|_| "Invalid repository settings")?
        }
        None => empty_manifest(),
    };
    manifest.version = 3;
    manifest.nodes.clear();
    manifest.links_by_source.clear();
    manifest.deleted_nodes.clear();
    manifest.restored_nodes.clear();
    for (path, bytes) in records {
        if path == SETTINGS {
            continue;
        }
        let id = path
            .strip_prefix("files/")
            .and_then(|name| name.strip_suffix(SUFFIX))
            .filter(|id| valid_component(id))
            .ok_or("Invalid metadata path")?;
        let mut record: Value = serde_json::from_slice(bytes)
            .map_err(|_| format!("Unreadable metadata for node {id}"))?;
        if record["version"] != 1 {
            return Err(format!("Unsupported metadata version for node {id}"));
        }
        if record["deleted"] == true {
            if record["id"] != id {
                return Err("Invalid deleted node ID".into());
            }
            let deletion = record["deletionId"]
                .as_str()
                .ok_or("Invalid deletion revision")?;
            manifest.deleted_nodes.insert(id.into(), deletion.into());
        } else {
            let node = parse_node(id, record["node"].take())?;
            let links = match record["links"].take() {
                Value::Array(links) => links,
                _ => return Err("Invalid stored note links".into()),
            };
            manifest.nodes.insert(id.into(), node);
            match record["restoredFrom"].take() {
                Value::Null => {}
                Value::String(revision) => {
                    manifest.restored_nodes.insert(id.into(), revision);
                }
                _ => return Err(format!("Invalid restore revision for node {id}")),
            }
            if !links.is_empty() {
                manifest.links_by_source.insert(id.into(), links);
            }
        }
    }
    normalize(&mut manifest);
    let mut detached = Vec::new();
    for (id, mut node) in &manifest.nodes {
        let mut visited = HashSet::from([id.as_str()]);
        while let Some(parent) = node.parent_id.as_deref() {
            match manifest.nodes.get(parent) {
                Some(candidate) if candidate.is_folder() && visited.insert(parent) => {
                    node = candidate;
                }
                _ => {
                    detached.push(id.clone());
                    break;
                }
            }
        }
    }
    for id in detached {
        manifest.nodes.get_mut(&id).unwrap().parent_id = None;
    }
    Ok(manifest)
}

pub(crate) struct Loaded {
    pub manifest: Manifest,
    pub records: HashMap<String, Vec<u8>>,
    pub corrupt: Vec<String>,
}

pub(crate) fn load(root: &Path) -> Result<Loaded, String> {
    reject_symlink(&root.join("manifest.json"))?;
    let marker = match fs::read(root.join("manifest.json")) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if let Some(bytes) = &marker {
        if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
            if value["version"].as_u64().is_some_and(|version| version > 4) {
                return Err(
                    "Unsupported repository storage version; update Myelin before opening".into(),
                );
            }
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
    if !records.contains_key(SETTINGS)
        && !corrupt.iter().any(|path| path == SETTINGS)
        && (marker.as_ref().is_some_and(|bytes| is_marker(bytes)) || !records.is_empty())
    {
        corrupt.push(SETTINGS.into());
    }
    let manifest = assemble(&records)?;
    Ok(Loaded {
        manifest,
        records,
        corrupt,
    })
}

pub(crate) fn normalize(manifest: &mut Manifest) {
    manifest.version = 3;
    if !manifest.colors.is_object() {
        manifest.colors = json!({});
    }
    for key in ["pen", "highlighter", "text", "folder"] {
        if !manifest.colors[key].is_array() {
            manifest.colors[key] = json!([]);
        }
    }
    if !manifest.tag_registry.is_array() {
        manifest.tag_registry = json!([]);
    }
    let presets = manifest.pen_presets.as_array().map(|entries| entries.iter().filter_map(|entry| {
        let (min, max) = match entry["tool"].as_str()? { "pen" => (1.0, 40.0), "highlighter" => (12.0, 60.0), _ => return None };
        let color = entry["color"].as_str()?.trim();
        let color = color.strip_prefix('#').unwrap_or(color);
        if color.len() != 6 || !color.bytes().all(|byte| byte.is_ascii_hexdigit()) || !entry["id"].is_string() { return None; }
        Some(json!({"id": entry["id"], "tool": entry["tool"], "color": format!("#{}", color.to_lowercase()), "size": entry["size"].as_f64()?.clamp(min, max)}))
    }).take(12).collect::<Vec<_>>()).unwrap_or_default();
    manifest.pen_presets = json!(presets);
    let flag_types = manifest.flag_types.as_array().map(|entries| entries.iter().filter_map(|entry| {
        let color = entry["color"].as_str()?.trim();
        let color = color.strip_prefix('#').unwrap_or(color);
        if color.len() != 6 || !color.bytes().all(|byte| byte.is_ascii_hexdigit()) || !entry["id"].is_string() || !entry["name"].is_string() { return None; }
        Some(json!({"id": entry["id"], "name": entry["name"], "color": format!("#{}", color.to_lowercase())}))
    }).collect::<Vec<_>>()).unwrap_or_default();
    manifest.flag_types = json!(flag_types);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nodes_round_trip_byte_for_byte() {
        // The order the TS client writes, plus an unknown field it may add later.
        let file = r#"{"id":"a","name":"A","type":"file","fileType":"mcanvas","parentId":null,"tags":["x"],"createdAt":1700000000000,"modifiedAt":1700000000001,"system":{"kind":"media","byteLength":3},"future":true}"#;
        let folder = r##"{"id":"b","name":"B","type":"folder","parentId":"a","tags":[],"createdAt":1,"modifiedAt":1,"color":"#ff0000"}"##;
        for json in [file, folder] {
            let value: Value = serde_json::from_str(json).unwrap();
            let node: Node = serde_json::from_value(value.clone()).unwrap();
            // Sidecars go through `json!`, so key order follows serde_json's map, as it always has.
            assert_eq!(
                serde_json::to_string(&json!(node)).unwrap(),
                serde_json::to_string(&value).unwrap()
            );
        }
    }

    #[test]
    fn invalid_nodes_are_rejected() {
        let base = json!({"id":"a","name":"A","type":"file","parentId":null,"tags":[],"createdAt":1,"modifiedAt":1});
        assert!(
            parse_node("a", base.clone()).is_err(),
            "file without fileType"
        );
        let mut mismatched = base.clone();
        mismatched["fileType"] = json!("png");
        assert!(
            parse_node("other", mismatched).is_err(),
            "id must match the record"
        );
        let mut traversal = base;
        traversal["fileType"] = json!("../png");
        assert!(
            parse_node("a", traversal).is_err(),
            "fileType must be a path component"
        );
    }
}
