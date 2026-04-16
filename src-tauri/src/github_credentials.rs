use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "com.github.wintersteve25.myelin";

fn github_entry(credential_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, &format!("github:{}", credential_id))
        .map_err(|error| format!("Failed to access secure credential storage: {}", error))
}

pub(crate) fn github_token(credential_id: &str) -> Result<String, String> {
    let entry = github_entry(credential_id)?;
    match entry.get_password() {
        Ok(token) if !token.is_empty() => Ok(token),
        Ok(_) | Err(KeyringError::NoEntry) => Err("GitHub token is not configured.".to_string()),
        Err(error) => Err(format!("Failed to read GitHub token: {}", error)),
    }
}

#[tauri::command]
pub fn github_secure_storage_available() -> Result<bool, String> {
    let entry = github_entry("__availability__")?;
    match entry.get_password() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn github_has_token(credential_id: String) -> Result<bool, String> {
    let entry = github_entry(&credential_id)?;
    match entry.get_password() {
        Ok(token) => Ok(!token.is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(error) => Err(format!("Failed to read GitHub token: {}", error)),
    }
}

#[tauri::command]
pub fn github_store_token(credential_id: String, token: String) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("GitHub token cannot be empty.".to_string());
    }

    let entry = github_entry(&credential_id)?;
    entry
        .set_password(trimmed)
        .map_err(|error| format!("Failed to store GitHub token: {}", error))
}

#[tauri::command]
pub fn github_clear_token(credential_id: String) -> Result<(), String> {
    let entry = github_entry(&credential_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to clear GitHub token: {}", error)),
    }
}
