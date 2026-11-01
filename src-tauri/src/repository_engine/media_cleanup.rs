use super::{media, store::file_name, FileWrite, Store};
use crate::repository_bootstrap::reject_symlink;
use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::Path};

// Reads stored files rather than the manifest, so a document whose metadata was quarantined still
// protects its media.
fn referenced(root: &Path) -> Result<HashSet<String>, String> {
    let mut paths = Vec::new();
    let mut list = |directory: &Path, extension: &str| -> Result<(), String> {
        reject_symlink(directory)?;
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().is_some_and(|kind| kind == extension) {
                paths.push(path);
            }
        }
        Ok(())
    };
    list(&root.join("files"), "myelin")?;
    let updates = root.join(".native-updates");
    if updates.exists() {
        reject_symlink(&updates)?;
        for entry in fs::read_dir(&updates).map_err(|error| error.to_string())? {
            list(&entry.map_err(|error| error.to_string())?.path(), "update")?;
        }
    }
    let mut referenced = HashSet::new();
    for path in paths {
        reject_symlink(&path)?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        if !bytes.is_empty() {
            referenced.extend(
                media::references(&bytes).map_err(|_| "Repository document is unreadable")?,
            );
        }
    }
    Ok(referenced)
}

/// Finishes applying another device's removal of `removed`, whose nodes are already gone. That device
/// only saw what had been synced, so anything a document here still points at is kept and published
/// again. Returns whether anything was. A failed scan keeps everything: an unneeded file is cheap and
/// a lost one is not.
pub(super) fn settle_removed(state: &mut Store, removed: Vec<Value>) -> Result<bool, String> {
    if removed.is_empty() {
        return Ok(false);
    }
    let referenced = referenced(&state.root).ok();
    let mut files = Vec::new();
    let mut restored = false;
    for node in removed {
        let hash = node["id"].as_str().ok_or("Invalid repository node ID")?;
        let name = file_name(&node)?;
        let needed = referenced.as_ref().is_none_or(|set| set.contains(hash));
        if needed && state.root.join("files").join(&name).exists() {
            let hash = hash.to_owned();
            state.manifest["nodes"][&hash] = node;
            state.queue("upsert-manifest-node", Some(&hash), json!({}));
            state.queue("push-note", Some(&hash), json!({"baseFileRevision": null}));
            restored = true;
        } else {
            files.push(FileWrite { name, bytes: None });
        }
    }
    state.commit(files)?;
    Ok(restored)
}
