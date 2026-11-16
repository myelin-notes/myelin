use super::{store, write_file, Changes, FileWrite, Store};
use crate::repository_metadata::{Node, NodeKind};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

const INTERVAL_MS: u64 = 10 * 60 * 1000;
const MAX_PER_FILE: usize = 32;

fn system<'a>(node: &'a Node, key: &str) -> &'a Value {
    node.system
        .as_ref()
        .map_or(&Value::Null, |system| &system[key])
}

fn captured_at(node: &Node) -> u64 {
    system(node, "capturedAt").as_u64().unwrap_or(0)
}

fn versions(state: &Store, id: &str) -> Vec<Node> {
    let mut versions = state
        .manifest
        .nodes
        .values()
        .filter(|node| {
            node.is_file()
                && node.system_kind() == Some("file-version")
                && system(node, "sourceFileId") == id
        })
        .cloned()
        .collect::<Vec<_>>();
    versions.sort_by_key(|node| std::cmp::Reverse(captured_at(node)));
    versions
}

pub(super) fn create(state: &mut Store, id: &str, force: bool) -> Result<(Value, Changes), String> {
    let Some(node) = state
        .manifest
        .file(id)
        .filter(|node| node.system.is_none())
        .cloned()
    else {
        return Ok((Value::Null, Changes::default()));
    };
    let captured_at = store::now();
    if !force
        && versions(state, id).first().is_some_and(|latest| {
            captured_at.saturating_sub(self::captured_at(latest)) < INTERVAL_MS
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
    node: &Node,
    bytes: &[u8],
    captured_at: u64,
) -> Result<(Value, Vec<FileWrite>, Changes), String> {
    let mut changes = Changes::default();
    let id = node.id.as_str();
    let source_revision = store::revision(bytes);
    let existing = versions(state, id);
    if bytes.is_empty()
        || existing.iter().any(|version| {
            system(version, "sourceRevision").as_str() == Some(source_revision.as_str())
        })
    {
        return Ok((Value::Null, Vec::new(), changes));
    }
    let timestamp = chrono::DateTime::from_timestamp_millis(captured_at as i64)
        .ok_or("Invalid version capture time")?
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let root = state
        .manifest
        .nodes
        .values()
        .find(|node| node.is_folder() && node.system_kind() == Some("version-history-root"))
        .map(|node| node.id.clone());
    let root_id = root
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let version_id = uuid::Uuid::new_v4().to_string();
    let version = Node {
        id: version_id.clone(),
        name: format!("{} {timestamp}", node.name),
        kind: NodeKind::File,
        file_type: node.file_type.clone(),
        parent_id: Some(root_id.clone()),
        tags: Vec::new(),
        created_at: captured_at.into(),
        modified_at: captured_at.into(),
        system: Some(json!({
            "kind": "file-version", "sourceFileId": id, "sourceFileType": node.file_type,
            "sourceName": node.name, "sourceRevision": source_revision,
            "capturedAt": captured_at, "byteLength": bytes.len()
        })),
        color: None,
        extra: Default::default(),
    };
    let mut files = vec![FileWrite {
        name: store::file_name(&version)?,
        bytes: Some(STANDARD.encode(bytes)),
    }];
    state.transaction_active = true;
    if root.is_none() {
        state.manifest.nodes.insert(
            root_id.clone(),
            Node {
                id: root_id.clone(),
                name: ".myelin-version-history".into(),
                kind: NodeKind::Folder,
                file_type: None,
                parent_id: None,
                tags: Vec::new(),
                created_at: captured_at.into(),
                modified_at: captured_at.into(),
                system: Some(json!({ "kind": "version-history-root" })),
                color: None,
                extra: Default::default(),
            },
        );
        state.queue("upsert-manifest-node", Some(&root_id), json!({}));
        changes.changed.push(root_id);
    }
    state.manifest.nodes.insert(version_id.clone(), version);
    state.queue("upsert-manifest-node", Some(&version_id), json!({}));
    state.queue(
        "push-note",
        Some(&version_id),
        json!({"baseFileRevision": null}),
    );
    changes.changed.push(version_id.clone());
    // Keep the new capture on timestamp ties so restore's safety copy cannot be pruned.
    for expired in existing.into_iter().skip(MAX_PER_FILE - 1) {
        let expired_id = expired.id.as_str();
        files.push(FileWrite {
            name: store::file_name(&expired)?,
            bytes: None,
        });
        state.manifest.nodes.remove(expired_id);
        state.manifest.remove_links(expired_id);
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
            "id": version_id, "sourceFileId": id, "sourceName": node.name, "fileType": node.file_type,
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
    let version = state
        .manifest
        .file(version_id)
        .filter(|version| {
            version.system_kind() == Some("file-version") && system(version, "sourceFileId") == id
        })
        .cloned()
        .ok_or("Version does not belong to this file.")?;
    let node = state
        .manifest
        .file(id)
        .filter(|node| node.system.is_none() && node.file_type == version.file_type)
        .cloned()
        .ok_or("Repository file is missing or has a different type.")?;
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
