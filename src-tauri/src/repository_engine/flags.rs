use super::{
    document,
    store::{file_name, FileWrite, Store},
    Changes, DocumentNotification,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use yrs::{Any, Array, Doc, Map, Out, ReadTxn, Transact};

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum FlagEdit {
    Remove,
    SetType { flag_type_id: String },
}

fn apply(doc: &Doc, ids: &HashSet<String>, edit: &FlagEdit) -> usize {
    let mut txn = doc.transact_mut();
    let Some(elements) = txn.get_array("elements") else {
        return 0;
    };
    let mut matches = Vec::new();
    for (index, value) in elements.iter(&txn).enumerate() {
        let Out::YMap(element) = value else { continue };
        let is_flag = matches!(
            element.get(&txn, "type"),
            Some(Out::Any(Any::Number(kind))) if kind == 9.0
        ) || matches!(element.get(&txn, "type"), Some(Out::Any(Any::BigInt(9))));
        let listed = matches!(
            element.get(&txn, "uuid"),
            Some(Out::Any(Any::String(uuid))) if ids.contains(uuid.as_ref())
        );
        if is_flag && listed {
            matches.push((index as u32, element));
        }
    }
    for (index, element) in matches.iter().rev() {
        match edit {
            FlagEdit::Remove => elements.remove(&mut txn, *index),
            FlagEdit::SetType { flag_type_id } => {
                element.insert(&mut txn, "flagTypeId", flag_type_id.as_str());
            }
        }
    }
    matches.len()
}

/// Edits flags in open and closed canvases alike; open editors receive the change as an update.
pub(super) fn edit(
    state: &mut Store,
    flag_ids: HashMap<String, HashSet<String>>,
    edit: FlagEdit,
) -> Result<(Value, Changes), String> {
    let mut changes = Changes::default();
    let mut files = Vec::new();
    for (id, ids) in flag_ids {
        if state.manifest["nodes"][&id]["fileType"] != "mcanvas" {
            continue;
        }
        let before = document::vector(state.doc(&id)?);
        state.transaction_active = true;
        if apply(state.doc(&id)?, &ids, &edit) == 0 {
            continue;
        }
        let (update, _) = document::diff(state.doc(&id)?, Some(&before))?;
        let generation = state
            .sync
            .document_generations
            .entry(id.clone())
            .or_insert_with(|| uuid::Uuid::new_v4().to_string())
            .clone();
        state.touch_document(&id, true)?;
        // A full write rather than a journal delta: flag listings read the saved file directly.
        files.push(FileWrite {
            name: file_name(&state.manifest["nodes"][&id])?,
            bytes: Some(STANDARD.encode(document::bytes(state.doc(&id)?))),
        });
        changes.changed.push(id.clone());
        changes.documents.push(DocumentNotification {
            node_id: id,
            bytes: update,
            source_session: None,
            origin: "local".into(),
            generation,
            replacement: false,
        });
    }
    if files.is_empty() {
        state.transaction_active = false;
    } else {
        state.commit(files)?;
    }
    changes.wake_remote = !changes.changed.is_empty() && state.remote;
    Ok((Value::Null, changes))
}
