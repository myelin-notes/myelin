import { invoke } from '@tauri-apps/api/core';

const SECURE_STORAGE_UNAVAILABLE_ERROR =
  'Secure credential storage is unavailable on this device.';

export async function isGitHubSecureStorageAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>('github_secure_storage_available');
  } catch {
    return false;
  }
}

export async function hasGitHubToken(credentialId: string): Promise<boolean> {
  return invoke<boolean>('github_has_token', { credentialId });
}

export async function storeGitHubToken(
  credentialId: string,
  token: string,
): Promise<void> {
  if (!(await isGitHubSecureStorageAvailable())) {
    throw new Error(SECURE_STORAGE_UNAVAILABLE_ERROR);
  }

  await invoke('github_store_token', { credentialId, token });
}

export async function clearGitHubToken(credentialId: string): Promise<void> {
  if (!(await isGitHubSecureStorageAvailable())) {
    throw new Error(SECURE_STORAGE_UNAVAILABLE_ERROR);
  }

  await invoke('github_clear_token', { credentialId });
}
