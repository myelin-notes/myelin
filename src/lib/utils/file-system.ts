import {
    BaseDirectory,
    exists,
    mkdir,
    open,
    readFile,
    readTextFile,
    remove,
    writeFile,
    writeTextFile,
} from "@tauri-apps/plugin-fs";
import { appCacheDir, appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ISerializable } from "./binary-helper";
import { BinaryReader, BinaryWriter } from "./binary-helper";

export const FileTypes = ['mcanvas', 'mdoc'] as const;
export type FileType = typeof FileTypes[number];

export interface VFSFileNode {
    id: string;
    name: string;
    type: 'file';
    fileType: FileType;
    parentId: string | null;
    tags: string[];
    createdAt: number;
    modifiedAt: number;
}

export interface VFSFolderNode {
    id: string;
    name: string;
    type: 'folder';
    parentId: string | null;
    children: string[];
    tags: string[];
    createdAt: number;
    modifiedAt: number;
}

export type VFSNode = VFSFileNode | VFSFolderNode;

export interface VFSManifest {
    version: number;
    children: string[];
    nodes: Record<string, VFSNode>;
}

function generateId(): string {
    return crypto.randomUUID();
}

const CURRENT_MANIFEST_VERSION = 1;
const MANIFEST_PATH = "manifest.json";
const FILES_DIR = "files";
const FILE_EXT = ".myelin";

export namespace FileSystem {
    let _manifest: VFSManifest | null = null;

    async function ensureDirs() {
        if (!await exists("", { baseDir: BaseDirectory.AppData })) {
            await mkdir("", { baseDir: BaseDirectory.AppData });
        }
        if (!await exists(FILES_DIR, { baseDir: BaseDirectory.AppData })) {
            await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
        }
        if (!await exists("Thumbnails", { baseDir: BaseDirectory.AppCache })) {
            await mkdir("Thumbnails", { baseDir: BaseDirectory.AppCache, recursive: true });
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function migrate(parsed: any): VFSManifest {
        const now = Date.now();
        for (const node of Object.values(parsed.nodes) as any[]) {
            if (node.createdAt == null) node.createdAt = now;
            if (node.modifiedAt == null) node.modifiedAt = now;
        }
        return parsed as VFSManifest;
    }

    async function loadManifest(): Promise<VFSManifest> {
        if (_manifest) return _manifest;

        await ensureDirs();

        if (await exists(MANIFEST_PATH, { baseDir: BaseDirectory.AppData })) {
            const text = await readTextFile(MANIFEST_PATH, { baseDir: BaseDirectory.AppData });
            const parsed = JSON.parse(text);
            _manifest = migrate(parsed);
            await saveManifest(_manifest);
            return _manifest;
        }

        const manifest: VFSManifest = { version: CURRENT_MANIFEST_VERSION, children: [], nodes: {} };
        await saveManifest(manifest);
        _manifest = manifest;
        return manifest;
    }

    async function saveManifest(manifest: VFSManifest) {
        _manifest = manifest;
        await writeTextFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), {
            baseDir: BaseDirectory.AppData,
        });
    }

    function getChildrenIds(manifest: VFSManifest, folderId: string | null): string[] {
        if (folderId === null) return manifest.children;
        const folder = manifest.nodes[folderId];
        if (!folder || folder.type !== 'folder') return [];
        return folder.children;
    }

    function addChild(manifest: VFSManifest, parentId: string | null, childId: string) {
        if (parentId === null) {
            manifest.children.push(childId);
        } else {
            const parent = manifest.nodes[parentId];
            if (parent && parent.type === 'folder') {
                parent.children.push(childId);
            }
        }
    }

    function removeChild(manifest: VFSManifest, parentId: string | null, childId: string) {
        if (parentId === null) {
            manifest.children = manifest.children.filter(id => id !== childId);
        } else {
            const parent = manifest.nodes[parentId];
            if (parent && parent.type === 'folder') {
                parent.children = parent.children.filter(id => id !== childId);
            }
        }
    }

    export async function getManifest(): Promise<VFSManifest> {
        return loadManifest();
    }

    export function getNode(manifest: VFSManifest, id: string): VFSNode | undefined {
        return manifest.nodes[id];
    }

    export function getChildren(manifest: VFSManifest, folderId: string | null): VFSNode[] {
        return getChildrenIds(manifest, folderId).map(id => manifest.nodes[id]).filter(Boolean);
    }

    export function getFolderChain(manifest: VFSManifest, folderId: string | null): VFSFolderNode[] {
        if (folderId === null) return [];
        const chain: VFSFolderNode[] = [];
        let current: VFSNode | undefined = manifest.nodes[folderId];
        while (current && current.type === 'folder') {
            chain.unshift(current);
            if (current.parentId === null) break;
            current = manifest.nodes[current.parentId];
        }
        return chain;
    }

    export async function loadDirectory(folderId: string | null): Promise<[VFSFolderNode[], VFSFileNode[]]> {
        const manifest = await loadManifest();
        const children = getChildren(manifest, folderId);

        const folders: VFSFolderNode[] = [];
        const files: VFSFileNode[] = [];

        for (const node of children) {
            if (node.type === 'folder') {
                folders.push(node);
            } else {
                files.push(node);
            }
        }

        return [folders, files];
    }

    export async function getThumbnailUrl(nodeId: string): Promise<string> {
        const url = await join(await appCacheDir(), "Thumbnails", `${nodeId}.png`);
        return convertFileSrc(url);
    }

    // --- Tag queries ---

    export function queryByTags(
        manifest: VFSManifest,
        filter: (tags: string[]) => boolean,
    ): VFSNode[] {
        return Object.values(manifest.nodes).filter(n => filter(n.tags));
    }

    export function getAllTags(manifest: VFSManifest): { tag: string; count: number }[] {
        const counts = new Map<string, number>();
        for (const node of Object.values(manifest.nodes)) {
            for (const tag of node.tags) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
        return Array.from(counts.entries())
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    export function getNodesByTag(manifest: VFSManifest, tag: string): VFSNode[] {
        return Object.values(manifest.nodes).filter(n => n.tags.includes(tag));
    }

    export function getNodesByAnyTag(manifest: VFSManifest, tags: string[]): VFSNode[] {
        const tagSet = new Set(tags);
        return Object.values(manifest.nodes).filter(n => n.tags.some(t => tagSet.has(t)));
    }

    export function searchNodes(manifest: VFSManifest, query: string): VFSNode[] {
        const q = query.toLowerCase();
        return Object.values(manifest.nodes).filter(n =>
            n.name.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q))
        );
    }

    export function getStats(manifest: VFSManifest): { totalFiles: number; totalFolders: number; totalTags: number } {
        let totalFiles = 0;
        let totalFolders = 0;
        const tagSet = new Set<string>();
        for (const node of Object.values(manifest.nodes)) {
            if (node.type === 'file') totalFiles++;
            else totalFolders++;
            for (const t of node.tags) tagSet.add(t);
        }
        return { totalFiles, totalFolders, totalTags: tagSet.size };
    }

    // --- Mutations ---

    export async function createFolder(name: string, parentId: string | null): Promise<string> {
        const manifest = await loadManifest();

        const id = generateId();
        const now = Date.now();
        manifest.nodes[id] = {
            id,
            name,
            type: 'folder',
            parentId,
            children: [],
            tags: [],
            createdAt: now,
            modifiedAt: now,
        };
        addChild(manifest, parentId, id);
        await saveManifest(manifest);
        return id;
    }

    export async function createFile(name: string, fileType: FileType, parentId: string | null): Promise<string> {
        const manifest = await loadManifest();

        const id = generateId();

        const filePath = await join(FILES_DIR, `${id}${FILE_EXT}`);
        const file = await open(filePath, {
            write: true,
            create: true,
            baseDir: BaseDirectory.AppData,
        });
        await file.close();

        const now = Date.now();
        manifest.nodes[id] = {
            id,
            name,
            type: 'file',
            fileType,
            parentId,
            tags: [],
            createdAt: now,
            modifiedAt: now,
        };
        addChild(manifest, parentId, id);
        await saveManifest(manifest);
        return id;
    }

    export async function renameNode(nodeId: string, newName: string) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return;
        node.name = newName;
        node.modifiedAt = Date.now();
        await saveManifest(manifest);
    }

    export async function deleteNode(nodeId: string) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return;

        removeChild(manifest, node.parentId, nodeId);

        // Collect all descendants to delete
        const toDelete: string[] = [];
        function collect(id: string) {
            toDelete.push(id);
            const n = manifest.nodes[id];
            if (n && n.type === 'folder') {
                for (const childId of n.children) {
                    collect(childId);
                }
            }
        }
        collect(nodeId);

        for (const id of toDelete) {
            const n = manifest.nodes[id];
            if (n && n.type === 'file') {
                const filePath = await join(FILES_DIR, `${id}${FILE_EXT}`);
                if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
                    await remove(filePath, { baseDir: BaseDirectory.AppData });
                }
                const thumbPath = await join("Thumbnails", `${id}.png`);
                if (await exists(thumbPath, { baseDir: BaseDirectory.AppCache })) {
                    await remove(thumbPath, { baseDir: BaseDirectory.AppCache });
                }
            }
            delete manifest.nodes[id];
        }

        await saveManifest(manifest);
    }

    export async function moveNode(nodeId: string, newParentId: string | null) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return;
        if (node.parentId === newParentId) return;

        if (newParentId !== null) {
            const newParent = manifest.nodes[newParentId];
            if (!newParent || newParent.type !== 'folder') return;

            // Prevent moving a folder into itself or a descendant
            if (node.type === 'folder') {
                let checkId: string | null = newParentId;
                while (checkId !== null) {
                    if (checkId === nodeId) return;
                    const n: VFSNode | undefined = manifest.nodes[checkId];
                    checkId = n?.parentId ?? null;
                }
            }
        }

        removeChild(manifest, node.parentId, nodeId);
        node.parentId = newParentId;
        node.modifiedAt = Date.now();
        addChild(manifest, newParentId, nodeId);
        await saveManifest(manifest);
    }

    export async function setTags(nodeId: string, tags: string[]) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return;
        node.tags = tags;
        node.modifiedAt = Date.now();
        await saveManifest(manifest);
    }

    export async function addTag(nodeId: string, tag: string) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node || node.tags.includes(tag)) return;
        node.tags.push(tag);
        node.modifiedAt = Date.now();
        await saveManifest(manifest);
    }

    export async function removeTag(nodeId: string, tag: string) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return;
        node.tags = node.tags.filter(t => t !== tag);
        node.modifiedAt = Date.now();
        await saveManifest(manifest);
    }

    export async function getUniqueFileName(baseName: string, parentId: string | null): Promise<string> {
        const manifest = await loadManifest();
        const children = getChildren(manifest, parentId);
        const names = new Set(children.map(n => n.name));

        if (!names.has(baseName)) return baseName;

        let counter = 1;
        while (names.has(`${baseName} ${counter}`)) {
            counter++;
        }
        return `${baseName} ${counter}`;
    }

    // --- File I/O (by node ID) ---

    export async function saveToFile(nodeId: string, content: ISerializable) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node || node.type !== 'file') return;

        const writer = new BinaryWriter(64);
        content.save(writer);
        if (writer.getBuffer().byteLength === 0) return;

        if (!await exists(FILES_DIR, { baseDir: BaseDirectory.AppData })) {
            await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
        }

        const filePath = await join(FILES_DIR, `${nodeId}${FILE_EXT}`);
        await writeFile(filePath, new Uint8Array(writer.getBuffer()), {
            baseDir: BaseDirectory.AppData,
        });

        node.modifiedAt = Date.now();
        await saveManifest(manifest);
    }

    export async function loadFromFile(nodeId: string, content: ISerializable) {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node || node.type !== 'file') return;

        const filePath = await join(FILES_DIR, `${nodeId}${FILE_EXT}`);
        if (!await exists(filePath, { baseDir: BaseDirectory.AppData })) return;
        const data = await readFile(filePath, { baseDir: BaseDirectory.AppData });
        if (data.length === 0) return;
        const reader = new BinaryReader(data.buffer);
        content.load(reader);
    }

    export async function saveThumbnail(nodeId: string, blob: Blob) {
        if (!await exists("Thumbnails", { baseDir: BaseDirectory.AppCache })) {
            await mkdir("Thumbnails", { baseDir: BaseDirectory.AppCache, recursive: true });
        }

        const thumbPath = await join("Thumbnails", `${nodeId}.png`);
        const file = await open(thumbPath, {
            write: true,
            append: false,
            create: true,
            baseDir: BaseDirectory.AppCache,
        });
        await file.write(new Uint8Array(await blob.arrayBuffer()));
        await file.close();
    }

    export async function getNodeFileName(nodeId: string): Promise<string | null> {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node) return null;
        return node.name;
    }

    export async function getNodeFileType(nodeId: string): Promise<FileType | null> {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node || node.type !== 'file') return null;
        return node.fileType;
    }

    export async function getDiskPath(nodeId: string): Promise<string | null> {
        const manifest = await loadManifest();
        const node = manifest.nodes[nodeId];
        if (!node || node.type !== 'file') return null;
        return join(await appDataDir(), FILES_DIR, `${nodeId}${FILE_EXT}`);
    }
}
