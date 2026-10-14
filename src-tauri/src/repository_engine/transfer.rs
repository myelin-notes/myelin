use super::{RepositoryHandle, RepositoryOperation};
use base64::{engine::general_purpose::STANDARD, Engine as _};

impl RepositoryHandle {
    pub(super) fn resolve_transfer(
        &mut self,
        operation: RepositoryOperation,
    ) -> Result<Option<RepositoryOperation>, String> {
        match operation {
            RepositoryOperation::StageBytes {
                transfer_id,
                offset,
                bytes_base64,
            } => {
                if bytes_base64.len() > 8192usize.div_ceil(3) * 4 {
                    return Err("Repository transfer chunk exceeds 8 KiB".into());
                }
                let bytes = STANDARD
                    .decode(bytes_base64)
                    .map_err(|_| "Invalid repository transfer bytes")?;
                if bytes.len() > 8192 {
                    return Err("Repository transfer chunk exceeds 8 KiB".into());
                }
                let pending = self.transfers.entry(transfer_id).or_default();
                if pending.len() != offset {
                    return Err("Repository transfer offset mismatch".into());
                }
                pending.extend_from_slice(&bytes);
                Ok(None)
            }
            RepositoryOperation::CancelTransfer { transfer_id } => {
                self.transfers.remove(&transfer_id);
                Ok(None)
            }
            RepositoryOperation::FinishTransfer {
                transfer_id,
                operation,
            } => {
                let mut operation = *operation;
                let payload = match &mut operation {
                    RepositoryOperation::WriteFile { bytes_base64, .. } => bytes_base64,
                    RepositoryOperation::UpdateDocument { update_base64, .. } => update_base64,
                    _ => return Err("Invalid repository transfer operation".into()),
                };
                if !payload.is_empty() {
                    return Err("Repository transfer operation already contains bytes".into());
                }
                let bytes = self
                    .transfers
                    .remove(&transfer_id)
                    .ok_or("Repository transfer is missing")?;
                *payload = STANDARD.encode(bytes);
                Ok(Some(operation))
            }
            operation => Ok(Some(operation)),
        }
    }
}
