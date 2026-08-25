import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '@myelin/editor/elements/element-type';
import { serializeDocToMarkdownChunked } from '@myelin/editor/page-frame/markdown/serializer';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import type { ReadableRepository, VFSFileNode, VFSNodeId } from '@/lib/sync';
import {
  type ExportPlan,
  type ExportProgress,
  type PlannedFile,
  planFolder,
  sanitizeName,
  type VaultFileEntry,
} from './workspace-plan';

const logger = new Logger('ObsidianVaultExport');

export interface ExportObsidianVaultResult {
  vaultPath: string;
  notesExported: number;
  filesCopied: number;
}

export interface ExportObsidianVaultOptions {
  repository: ReadableRepository;
  /** Absolute directory the user picked; the vault is created as a subfolder. */
  destDir: string;
  /** Name of the root vault folder created under {@link destDir}. */
  vaultName: string;
  onProgress?: (progress: ExportProgress) => void;
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_/.-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Obsidian-style YAML frontmatter carrying tags and timestamps. */
function buildFrontmatter(node: VFSFileNode): string {
  const lines = ['---'];
  if (node.tags.length > 0) {
    lines.push('tags:');
    for (const tag of node.tags) {
      lines.push(`  - ${yamlScalar(tag)}`);
    }
  }
  lines.push(`created: ${new Date(node.createdAt).toISOString()}`);
  lines.push(`modified: ${new Date(node.modifiedAt).toISOString()}`);
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Concatenate every page frame of a canvas note into a single markdown body.
 * Non-page-frame elements (embedded media, canvas text, drawings) are ignored.
 */
async function noteMarkdownBody(
  repository: ReadableRepository,
  noteId: VFSNodeId,
): Promise<string> {
  const snapshot = await repository.loadDocument(noteId);
  const ydoc = snapshot.update
    ? YDocManager.fromUpdate(snapshot.update)
    : new YDocManager();

  const frames: string[] = [];
  for (let index = 0; index < ydoc.elements.length; index++) {
    const yMap = ydoc.elements.get(index);
    if (yMap.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }
    const uuid = yMap.get('uuid');
    if (typeof uuid !== 'string') {
      continue;
    }
    const doc = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment(uuid),
      schema,
    );
    const markdown = (await serializeDocToMarkdownChunked(doc)).trim();
    if (markdown.length > 0) {
      frames.push(markdown);
    }
  }

  return frames.join('\n\n');
}

/** Build the markdown body / source path a single file contributes, or null to skip. */
async function buildFileEntry(
  repository: ReadableRepository,
  file: PlannedFile,
): Promise<{ entry: VaultFileEntry; isNote: boolean } | null> {
  const relPath = [...file.segments, file.fileName].join('/');

  if (file.node.fileType === 'mcanvas') {
    const body = await noteMarkdownBody(repository, file.node.id);
    return {
      entry: { relPath, text: `${buildFrontmatter(file.node)}${body}\n` },
      isNote: true,
    };
  }

  // Media is mirrored on disk (local repo, or the local cache of a synced repo),
  // so the Rust side copies the stored bytes directly from this path.
  const sourcePath = await repository.getStoredAbsolutePath(file.node.id);
  if (!sourcePath) {
    logger.warn('Skipping file with no stored path', {
      nodeId: file.node.id,
      name: file.node.name,
    });
    return null;
  }
  return { entry: { relPath, copyFrom: sourcePath }, isNote: false };
}

export async function exportObsidianVault({
  repository,
  destDir,
  vaultName,
  onProgress,
}: ExportObsidianVaultOptions): Promise<ExportObsidianVaultResult> {
  const plan: ExportPlan = { folders: [], files: [] };
  await planFolder(repository, null, [], plan, 'md');

  const entries: VaultFileEntry[] = [];
  let notesExported = 0;
  let filesCopied = 0;
  const total = plan.files.length;
  let current = 0;

  for (const file of plan.files) {
    onProgress?.({ current: ++current, total, name: file.node.name });
    const built = await buildFileEntry(repository, file);
    if (!built) {
      continue;
    }
    entries.push(built.entry);
    if (built.isNote) {
      notesExported += 1;
    } else {
      filesCopied += 1;
    }
  }

  const vaultPath = await invoke<string>('export_obsidian_vault', {
    request: {
      destDir,
      vaultName: sanitizeName(vaultName) || 'Vault',
      folders: plan.folders,
      files: entries,
    },
  });

  return { vaultPath, notesExported, filesCopied };
}
