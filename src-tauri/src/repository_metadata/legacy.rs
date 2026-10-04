use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

// Omitting nodes makes older clients reject migrated repositories before writing.
pub(crate) const MARKER: &[u8] =
    br#"{"version":4,"format":"myelin-sidecars","upgradeRequired":true}"#;
pub(crate) const BACKUP: &str = "manifest.legacy.json";

pub(crate) fn parse_manifest(bytes: &[u8]) -> Result<Value, String> {
    let manifest: Value =
        serde_json::from_slice(bytes).map_err(|_| "Unreadable repository manifest")?;
    if !manifest.get("version").is_some_and(Value::is_number)
        || !manifest.get("nodes").is_some_and(Value::is_object)
    {
        return Err("Invalid repository manifest".into());
    }
    Ok(manifest)
}

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct Journal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    manifest: Option<Value>,
}

impl Journal {
    pub(crate) fn replay(&self, root: &Path) -> Result<(), String> {
        if let Some(manifest) = &self.manifest {
            crate::repository_engine::store::atomic_write(
                &root.join("manifest.json"),
                &serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?,
            )?;
        }
        Ok(())
    }
}

pub(crate) fn migrate(manifest: &mut Value) {
    if manifest["version"].as_u64().unwrap_or(1) < 2 {
        manifest.as_object_mut().unwrap().remove("children");
        for node in manifest["nodes"].as_object_mut().unwrap().values_mut() {
            if let Some(node) = node.as_object_mut() {
                node.remove("children");
            }
        }
    }
    if manifest["version"].as_u64().unwrap_or(1) < 3 {
        let pen = manifest["customColors"]
            .as_array()
            .map(|colors| colors.iter().take(8).cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        manifest["colors"] = json!({"pen": pen, "highlighter": [], "text": [], "folder": []});
        manifest.as_object_mut().unwrap().remove("customColors");
    }
    super::normalize(manifest);
}
