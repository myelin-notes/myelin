use super::{
    media,
    store::{atomic_write, file_name},
    FileWrite, Store,
};
use crate::repository_bootstrap::reject_symlink;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

const SCAN_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
// Current versions restore media they still need, but older ones cannot, so this gives them time to
// update and catches anything that only looks unused for a while.
const UNUSED_FOR_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const PROGRESS_FILE: &str = ".native-media-unused.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    scanned_at: u64,
    first_unused_at: HashMap<String, u64>,
}

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

/// Removes media that no document has pointed at for `UNUSED_FOR_MS` and returns how many. Waits until
/// this device has synced and has nothing pending, because only then does it hold every document, and
/// removes nothing if any document cannot be read. Timing is per device, so it causes no sync traffic.
pub(super) fn clean(state: &mut Store, now: u64) -> Result<usize, String> {
    if state.recovery_error.is_some()
        || !state.outbox.is_empty()
        || (state.remote && state.sync.last_remote_sync_at.is_none())
    {
        return Ok(0);
    }
    let path = state.root.join(PROGRESS_FILE);
    let saved: Progress = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if now.saturating_sub(saved.scanned_at) < SCAN_INTERVAL_MS {
        return Ok(0);
    }
    let referenced = referenced(&state.root)?;
    let unused: Vec<Value> = state.manifest["nodes"]
        .as_object()
        .unwrap()
        .values()
        .filter(|node| {
            node["system"]["kind"] == "media"
                && node["id"]
                    .as_str()
                    .is_some_and(|id| !referenced.contains(id))
        })
        .cloned()
        .collect();
    let mut progress = Progress {
        scanned_at: now,
        first_unused_at: HashMap::new(),
    };
    let mut files = Vec::new();
    for node in unused {
        let hash = node["id"].as_str().ok_or("Invalid repository node ID")?;
        let first = saved.first_unused_at.get(hash).copied().unwrap_or(now);
        if now.saturating_sub(first) < UNUSED_FOR_MS {
            progress.first_unused_at.insert(hash.to_owned(), first);
            continue;
        }
        state.transaction_active = true;
        state.manifest["nodes"]
            .as_object_mut()
            .unwrap()
            .remove(hash);
        state.queue(
            "delete-manifest-node",
            Some(hash),
            json!({"deletedFileIds": [hash]}),
        );
        files.push(FileWrite {
            name: file_name(&node)?,
            bytes: None,
        });
    }
    let removed = files.len();
    if removed > 0 {
        state.commit(files)?;
    }
    atomic_write(
        &path,
        &serde_json::to_vec(&progress).map_err(|error| error.to_string())?,
    )?;
    Ok(removed)
}
