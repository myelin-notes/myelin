use super::{store, write_file, Changes, FileWrite, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

const INTERVAL_MS: u64 = 10 * 60 * 1000;
const MAX_PER_FILE: usize = 32;

fn versions(state: &Store, id: &str) -> Vec<Value> {
    let mut versions = state.manifest["nodes"]
        .as_object()
        .unwrap()
        .values()
        .filter(|node| {
            node["type"] == "file"
                && node["system"]["kind"] == "file-version"
                && node["system"]["sourceFileId"] == id
        })
        .cloned()
        .collect::<Vec<_>>();
    versions
        .sort_by_key(|node| std::cmp::Reverse(node["system"]["capturedAt"].as_u64().unwrap_or(0)));
    versions
}

pub(super) fn create(state: &mut Store, id: &str, force: bool) -> Result<(Value, Changes), String> {
    let node = state.manifest["nodes"][id].clone();
    if node["type"] != "file" || !node["system"].is_null() {
        return Ok((Value::Null, Changes::default()));
    }
    let captured_at = store::now();
    if !force
        && versions(state, id).first().is_some_and(|latest| {
            captured_at.saturating_sub(latest["system"]["capturedAt"].as_u64().unwrap_or(0))
                < INTERVAL_MS
        })
    {
        return Ok((Value::Null, Changes::default()));
    }
    let bytes = state.read_file(&node)?;
    let (version, files, changes) = capture(state, &node, &bytes, captured_at)?;
    if !files.is_empty() {
        state.commit(files)?;
    }
    Ok((version, changes))
}

fn capture(
    state: &mut Store,
    node: &Value,
    bytes: &[u8],
    captured_at: u64,
) -> Result<(Value, Vec<FileWrite>, Changes), String> {
    let mut changes = Changes::default();
    let id = node["id"].as_str().ok_or("Invalid repository node ID")?;
    let source_revision = store::revision(bytes);
    let existing = versions(state, id);
    if bytes.is_empty()
        || existing
            .iter()
            .any(|version| version["system"]["sourceRevision"] == source_revision)
    {
        return Ok((Value::Null, Vec::new(), changes));
    }
    let timestamp = chrono::DateTime::from_timestamp_millis(captured_at as i64)
        .ok_or("Invalid version capture time")?
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let root = state.manifest["nodes"]
        .as_object()
        .unwrap()
        .values()
        .find(|node| node["type"] == "folder" && node["system"]["kind"] == "version-history-root")
        .map(|node| node["id"].as_str().unwrap().to_owned());
    let root_id = root
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let version_id = uuid::Uuid::new_v4().to_string();
    let version = json!({
        "id": version_id, "type": "file", "name": format!("{} {timestamp}", node["name"].as_str().unwrap_or_default()),
        "fileType": node["fileType"], "parentId": root_id, "tags": [],
        "createdAt": captured_at, "modifiedAt": captured_at,
        "system": {
            "kind": "file-version", "sourceFileId": id, "sourceFileType": node["fileType"],
            "sourceName": node["name"], "sourceRevision": source_revision,
            "capturedAt": captured_at, "byteLength": bytes.len()
        }
    });
    let mut files = vec![FileWrite {
        name: store::file_name(&version)?,
        bytes: Some(STANDARD.encode(bytes)),
    }];
    state.transaction_active = true;
    if root.is_none() {
        state.manifest["nodes"][&root_id] = json!({
            "id": root_id, "type": "folder", "name": ".myelin-version-history", "parentId": null,
            "tags": [], "createdAt": captured_at, "modifiedAt": captured_at,
            "system": { "kind": "version-history-root" }
        });
        state.queue("upsert-manifest-node", Some(&root_id), json!({}));
        changes.changed.push(root_id);
    }
    state.manifest["nodes"][&version_id] = version.clone();
    state.queue("upsert-manifest-node", Some(&version_id), json!({}));
    state.queue(
        "push-note",
        Some(&version_id),
        json!({"baseFileRevision": null}),
    );
    changes.changed.push(version_id.clone());
    // Keep the new capture on timestamp ties so restore's safety copy cannot be pruned.
    for expired in existing.into_iter().skip(MAX_PER_FILE - 1) {
        let expired_id = expired["id"].as_str().unwrap();
        files.push(FileWrite {
            name: store::file_name(&expired)?,
            bytes: None,
        });
        state.manifest["nodes"]
            .as_object_mut()
            .unwrap()
            .remove(expired_id);
        state.manifest["linksBySource"]
            .as_object_mut()
            .unwrap()
            .remove(expired_id);
        state.documents.remove(expired_id);
        state.sync.document_generations.remove(expired_id);
        state.outbox.retain(|op| op["nodeId"] != expired_id);
        state.queue(
            "delete-manifest-node",
            Some(expired_id),
            json!({"deletedFileIds": [expired_id]}),
        );
        changes.deleted.push(expired_id.to_owned());
    }
    changes.wake_remote = state.remote;
    Ok((
        json!({
            "id": version_id, "sourceFileId": id, "sourceName": node["name"], "fileType": node["fileType"],
            "sourceRevision": source_revision, "capturedAt": captured_at, "byteLength": bytes.len()
        }),
        files,
        changes,
    ))
}

pub(super) fn restore(
    state: &mut Store,
    id: &str,
    version_id: &str,
) -> Result<(Value, Changes), String> {
    let version = state.manifest["nodes"][version_id].clone();
    if version["type"] != "file"
        || version["system"]["kind"] != "file-version"
        || version["system"]["sourceFileId"] != id
    {
        return Err("Version does not belong to this file.".into());
    }
    let node = state.manifest["nodes"][id].clone();
    if node["type"] != "file"
        || !node["system"].is_null()
        || node["fileType"] != version["fileType"]
    {
        return Err("Repository file is missing or has a different type.".into());
    }
    let bytes = state.read_file(&version)?;
    if bytes.is_empty() {
        return Err("Version data is missing.".into());
    }
    let current = state.read_file(&node)?;
    if store::revision(&current) == store::revision(&bytes) {
        return Ok((Value::Null, Changes::default()));
    }
    let (_, files, mut changes) = capture(state, &node, &current, store::now())?;
    let (_, restored) = write_file(state, node, bytes, true, true, files)?;
    changes.changed.extend(restored.changed);
    changes.documents.extend(restored.documents);
    changes.wake_remote |= restored.wake_remote;
    Ok((Value::Null, changes))
}
