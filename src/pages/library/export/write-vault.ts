import * as scoped from 'tauri-plugin-scoped-storage-api';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import type { PickedFolder } from '@/lib/folder-picker';
import type { VaultFileEntry } from './workspace-plan';

interface VaultExportRequest {
  destDir: PickedFolder;
  vaultName: string;
  folders: string[];
  files: VaultFileEntry[];
}

export async function writeVault(request: VaultExportRequest): Promise<string> {
  const { destDir, vaultName, folders, files } = request;
  if (destDir.kind === 'native') {
    return invoke<string>('export_obsidian_vault', {
      request: { ...request, destDir: destDir.path },
    });
  }

  const id = destDir.handle.id;
  let root = vaultName;
  let suffix = 2;
  while (await scoped.exists(id, root)) {
    root = `${vaultName} (${suffix++})`;
  }
  await scoped.mkdir(id, root);
  try {
    for (const folder of folders) {
      await scoped.mkdir(id, `${root}/${folder}`, true);
    }
    for (const file of files) {
      const path = `${root}/${file.relPath}`;
      if (file.text !== undefined) {
        await scoped.writeTextFile(id, path, file.text, { recursive: true });
      } else if (file.copyFrom !== undefined) {
        await scoped.writeFile(id, path, await readFile(file.copyFrom), {
          recursive: true,
        });
      }
    }
  } catch (error) {
    await scoped.removeDir(id, root, true).catch(() => {});
    throw error;
  }
  return root;
}
