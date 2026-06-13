/**
 * Exports the entire library to a plain folder tree on disk: the VFS folder
 * hierarchy becomes real directories, notes become Markdown files with an
 * Obsidian-style YAML frontmatter header (tags + timestamps), and image/video
 * files are copied verbatim into the matching folders.
 *
 * Canvas notes can hold non-text content (strokes, shapes, on-canvas images,
 * PDFs) that Markdown can't represent — only the page-frame text is exported,
 * so the result is intentionally lossy for those parts.
 */

import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { join } from '@tauri-apps/api/path';
import { mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Repository, VFSNode, VFSNodeId } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { serializeDocToMarkdownChunked } from '@/pages/canvas/page-frame/markdown/serializer';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';

export interface ExportProgress {
  /** Number of files written so far. */
  written: number;
}

/**
 * Walks the whole library starting at the root and writes it under
 * `destRoot`. Returns the number of files written.
 */
export async function exportLibraryAsMarkdown(
  repository: Repository,
  destRoot: string,
  onProgress: (progress: ExportProgress) => void,
): Promise<number> {
  let written = 0;

  const walk = async (
    folderId: VFSNodeId | null,
    dirPath: string,
  ): Promise<void> => {
    const [folders, files] = await repository.listDirectory(folderId);
    // Folders and files share one namespace on disk, so dedupe across both.
    const used = new Set<string>();

    for (const file of files) {
      if (file.system) {
        continue; // Skip version-history snapshots.
      }
      const bytes = await repository.readFileBytes(file.id);
      if (!bytes) {
        continue;
      }
      const isCanvas = file.fileType === 'mcanvas';
      const name = uniqueName(
        used,
        isCanvas
          ? canvasFileName(file.name)
          : mediaFileName(file.name, file.fileType),
      );
      const fullPath = await join(dirPath, name);
      if (isCanvas) {
        const body = await canvasToMarkdownBody(bytes);
        await writeTextFile(fullPath, buildFrontmatter(file) + body);
      } else {
        await writeFile(fullPath, bytes);
      }
      written++;
      onProgress({ written });
    }

    for (const folder of folders) {
      if (folder.system) {
        continue;
      }
      const name = uniqueName(used, sanitizeName(folder.name, 'folder'));
      const subPath = await join(dirPath, name);
      await mkdir(subPath, { recursive: true });
      await walk(folder.id, subPath);
    }
  };

  await walk(null, destRoot);
  return written;
}

/** Concatenate every page frame's text in a canvas into one Markdown body. */
async function canvasToMarkdownBody(bytes: Uint8Array): Promise<string> {
  const ydoc = YDocManager.fromUpdate(bytes);
  const parts: string[] = [];
  for (let i = 0; i < ydoc.elements.length; i++) {
    const element = ydoc.elements.get(i);
    if (element.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }
    const uuid = element.get('uuid');
    if (typeof uuid !== 'string') {
      continue;
    }
    const fragment = ydoc.getXmlFragment(uuid);
    if (fragment.length === 0) {
      continue;
    }
    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    const md = (await serializeDocToMarkdownChunked(doc)).trim();
    if (md) {
      parts.push(md);
    }
  }
  // Separate multiple page frames with a thematic break, like Obsidian pages.
  return parts.join('\n\n---\n\n');
}

/** Build the Obsidian-style YAML frontmatter block (always ends with a newline). */
function buildFrontmatter(node: VFSNode): string {
  const lines = ['---'];
  const tags = node.tags.filter((tag) => tag.trim().length > 0);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${yamlScalar(tag)}`);
    }
  }
  lines.push(`created: ${new Date(node.createdAt).toISOString()}`);
  lines.push(`modified: ${new Date(node.modifiedAt).toISOString()}`);
  lines.push('---', '', '');
  return lines.join('\n');
}

/** Quote a YAML scalar only when it contains characters outside a safe set. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_\-/.]+$/.test(value) ? value : JSON.stringify(value);
}

function canvasFileName(name: string): string {
  return `${sanitizeName(name.replace(/\.mcanvas$/i, ''), 'untitled')}.md`;
}

function mediaFileName(name: string, fileType: string): string {
  const base = sanitizeName(name, 'file');
  return base.toLowerCase().endsWith(`.${fileType.toLowerCase()}`)
    ? base
    : `${base}.${fileType}`;
}

function sanitizeName(name: string, fallback: string): string {
  // Replace each illegal char (control chars + Windows-forbidden set), then
  // strip trailing dots/spaces, which are also illegal on Windows.
  const cleaned = [...name]
    .map((char) =>
      char.charCodeAt(0) <= 0x1f || '/\\:*?"<>|'.includes(char) ? '-' : char,
    )
    .join('')
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned || fallback;
}

/** Return `name` if unused in `used`, otherwise append " (2)", " (3)", … */
function uniqueName(used: Set<string>, name: string): string {
  const register = (candidate: string): string => {
    used.add(candidate.toLowerCase());
    return candidate;
  };
  if (!used.has(name.toLowerCase())) {
    return register(name);
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem} (${i})${ext}`.toLowerCase())) {
    i++;
  }
  return register(`${stem} (${i})${ext}`);
}
