import { filesProvider } from './files';
import { goodnotesProvider } from './goodnotes';
import { obsidianProvider } from './obsidian';
import { onenoteProvider } from './onenote';
import type { ImportProvider, ImportProviderId } from './types';
import { workspaceJsonProvider } from './workspace-json';

/** Registration order is the order rows appear in the import picker. */
export const IMPORT_PROVIDERS: readonly ImportProvider[] = [
  filesProvider,
  goodnotesProvider,
  onenoteProvider,
  obsidianProvider,
  workspaceJsonProvider,
];

export function getImportProvider(id: ImportProviderId): ImportProvider {
  const provider = IMPORT_PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(`Unknown import provider: ${id}`);
  }
  return provider;
}

export type {
  ImportProvider,
  ImportProviderId,
  ImportSelection,
} from './types';
