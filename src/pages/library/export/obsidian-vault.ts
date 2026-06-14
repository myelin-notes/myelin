import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { join } from '@tauri-apps/api/path';
import {
  exists,
  mkdir,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import type { McpReadableRepository } from '@/lib/mcp/read-model';
import type { VFSFileNode, VFSNodeId } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { serializeDocToMarkdownChunked } from '@/pages/canvas/page-frame/markdown/serializer';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';

const logger = new Logger('ObsidianVaultExport');

const ILLEGAL_NAME_CHARS = '/\\:*?"<>|';

export interface ExportProgress {
  current: number;
  total: number;
  name: string;
}

export interface ExportObsidianVaultResult {
  vaultPath: string;
  notesExported: number;
  filesCopied: number;
}

export interface ExportObsidianVaultOptions {
  repository: McpReadableRepository;
  /** Absolute directory the user picked; the vault is created as a subfolder. */
  destDir: string;
  /** Name of the root vault folder created under {@link destDir}. */
  vaultName: string;
  onProgress?: (progress: ExportProgress) => void;
}

interface PlannedFile {
  node: VFSFileNode;
  /** Output directory relative to the vault root. */
  segments: readonly string[];
  fileName: string;
}

interface ExportPlan {
  folders: readonly string[][];
  files: PlannedFile[];
}

/** Replace filesystem-illegal characters and trim Windows-unsafe trailing dots. */
function sanitizeName(name: string): string {
  const cleaned = [...name]
    .map((char) =>
      char.charCodeAt(0) <= 0x1f || ILLEGAL_NAME_CHARS.includes(char)
        ? '-'
        : char,
    )
    .join('')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned;
}

/** Ensure a file/folder name is unique within its directory (case-insensitive). */
function dedupeName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName.toLowerCase())) {
    used.add(fileName.toLowerCase());
    return fileName;
  }
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  let suffix = 2;
  let candidate = `${stem} (${suffix})${ext}`;
  while (used.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem} (${suffix})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function planFolder(
  repository: McpReadableRepository,
  folderId: VFSNodeId | null,
  parentSegments: readonly string[],
  plan: ExportPlan & { folders: string[][]; files: PlannedFile[] },
): Promise<void> {
  const [folders, files] = await repository.listDirectory(folderId);
  const used = new Set<string>();

  for (const folder of folders) {
    const name = dedupeName(sanitizeName(folder.name) || 'Folder', used);
    const segments = [...parentSegments, name];
    plan.folders.push(segments);
    await planFolder(repository, folder.id, segments, plan);
  }

  for (const file of files) {
    const isNote = file.fileType === 'mcanvas';
    const base = sanitizeName(file.name) || (isNote ? 'Untitled' : 'file');
    const fileName = dedupeName(isNote ? `${base}.md` : base, used);
    plan.files.push({ node: file, segments: parentSegments, fileName });
  }
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
  repository: McpReadableRepository,
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

async function resolveVaultPath(
  destDir: string,
  vaultName: string,
): Promise<string> {
  const base = sanitizeName(vaultName) || 'Vault';
  let candidate = base;
  let suffix = 2;
  let path = await join(destDir, candidate);
  while (await exists(path)) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
    path = await join(destDir, candidate);
  }
  return path;
}

export async function exportObsidianVault({
  repository,
  destDir,
  vaultName,
  onProgress,
}: ExportObsidianVaultOptions): Promise<ExportObsidianVaultResult> {
  const plan: ExportPlan & { folders: string[][]; files: PlannedFile[] } = {
    folders: [],
    files: [],
  };
  await planFolder(repository, null, [], plan);

  const vaultPath = await resolveVaultPath(destDir, vaultName);
  let notesExported = 0;
  let filesCopied = 0;
  const total = plan.files.length;
  let current = 0;

  try {
    await mkdir(vaultPath, { recursive: true });
    for (const segments of plan.folders) {
      await mkdir(await join(vaultPath, ...segments), { recursive: true });
    }

    for (const file of plan.files) {
      onProgress?.({ current: ++current, total, name: file.node.name });
      const targetPath = await join(vaultPath, ...file.segments, file.fileName);

      if (file.node.fileType === 'mcanvas') {
        const body = await noteMarkdownBody(repository, file.node.id);
        const frontmatter = buildFrontmatter(file.node);
        await writeTextFile(targetPath, `${frontmatter}${body}\n`);
        notesExported += 1;
        continue;
      }

      const bytes = await repository.readFileBytes(file.node.id);
      if (!bytes) {
        logger.warn('Skipping file with no stored bytes', {
          nodeId: file.node.id,
          name: file.node.name,
        });
        continue;
      }
      await writeFile(targetPath, bytes);
      filesCopied += 1;
    }

    return { vaultPath, notesExported, filesCopied };
  } catch (error) {
    logger.error('Failed to export Obsidian vault', error, { vaultPath });
    await remove(vaultPath, { recursive: true }).catch((cleanupError) => {
      logger.error(
        'Failed to clean up partial Obsidian vault export',
        cleanupError,
        { vaultPath },
      );
    });
    throw error;
  }
}
