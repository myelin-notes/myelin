import {
    BaseDirectory,
    exists,
    mkdir,
    open,
    readDir,
    readFile,
    remove,
    rename,
    stat,
    writeFile
} from "@tauri-apps/plugin-fs";
import {appCacheDir, basename, dirname, extname, join} from "@tauri-apps/api/path";
import {convertFileSrc, invoke} from "@tauri-apps/api/core";
import {ISerializable} from "./ISerializable";
import {BinaryReader, BinaryWriter} from "./BinaryHelper";

export const FileTypes = ['mcanvas', 'mdoc'] as const;
export type FileType = typeof FileTypes[number];

export interface MyelinFile {
    preview: string;
    name: string;
    type: FileType;
}

export namespace FileSystem {
    export async function loadDirectory(path: string[]): Promise<[string[], MyelinFile[]]> {
        const pathJoined = await join(...path);

        if (!await exists("", {baseDir: BaseDirectory.AppData})) {
            await mkdir("", {baseDir: BaseDirectory.AppData});
        }

        if (!await exists("Home", {baseDir: BaseDirectory.AppData})) {
            await mkdir("Home", {baseDir: BaseDirectory.AppData});
        }

        const result = await readDir(pathJoined, {
            baseDir: BaseDirectory.AppData,
        });

        const dirs: string[] = [];
        const files: MyelinFile[] = [];

        for (const entry of result) {
            if (entry.isSymlink) {
                continue;
            }

            if (entry.isDirectory) {
                dirs.push(entry.name);
                continue;
            }

            if (entry.isFile) {
                const ext = await extname(entry.name);
                let name = await basename(entry.name, ext);
                name = name.slice(0, name.length - 1);

                if (!isValidFileType(ext)) {
                    continue;
                }

                files.push(await parseFile(path, name, ext));
            }
        }

        return [dirs, files];
    }

    export async function deleteFileOrFolder(path: string[]) {
        const url = await join(...path);
        const isDir = (await stat(url, { baseDir: BaseDirectory.AppData })).isDirectory;
        await remove(url, {baseDir: BaseDirectory.AppData, recursive: true});
        const thumbnailUrl = await join("Thumbnails", isDir ? await join(...path) : await join(...path) + ".png");

        if (await exists(thumbnailUrl, { baseDir: BaseDirectory.AppCache })) {
            await remove(thumbnailUrl, { baseDir: BaseDirectory.AppCache, recursive: true });
        }
    }

    export async function renameFileOrFolder(path: string, to: string) {
        const pathTo = await dirname(path);
        const j = await join(pathTo, to);

        if ((await stat(path, {baseDir: BaseDirectory.AppData})).isFile) {
            const ext = await extname(path);
            await rename(path, `${j}.${ext}`, {
                oldPathBaseDir: BaseDirectory.AppData,
                newPathBaseDir: BaseDirectory.AppData
            });

            await rename(await join("Thumbnails", path + ".png"), await join("Thumbnails", `${j}.${ext}.png`), {
                oldPathBaseDir: BaseDirectory.AppCache,
                newPathBaseDir: BaseDirectory.AppCache
            })
            return;
        }

        await rename(path, `${j}`, {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData
        });

        await rename(await join("Thumbnails", path), await join("Thumbnails", j), {
            oldPathBaseDir: BaseDirectory.AppCache,
            newPathBaseDir: BaseDirectory.AppCache
        });
    }

    function isValidFileType(str: unknown): str is FileType {
        // @ts-ignore
        return typeof str === "string" && FileTypes.includes(str);
    }

    async function parseFile(path: string[], name: string, ext: FileType): Promise<MyelinFile> {
        if (!(await exists("Thumbnails", {baseDir: BaseDirectory.AppCache}))) {
            await mkdir("Thumbnails", {baseDir: BaseDirectory.AppCache, recursive: true});
        }

        const url = await join(await appCacheDir(), "Thumbnails", `${await join(...path, name)}.${ext}.png`);
        return {
            preview: convertFileSrc(url),
            name: name,
            type: ext,
        };
    }

    export async function saveThumbnail(path: string[], blob: Blob) {
        if (!(await exists("Thumbnails", {baseDir: BaseDirectory.AppCache}))) {
            await mkdir("Thumbnails", {baseDir: BaseDirectory.AppCache, recursive: true});
        }

        const url = (await join("Thumbnails", ...path)) + '.png';
        await invoke("create_dir_all", {
            path: await join(await appCacheDir(), "Thumbnails", ...path.slice(0, path.length - 1))
        });
        const file = await open(url, {
            write: true,
            append: false,
            create: true,
            baseDir: BaseDirectory.AppCache
        });
        await file.write(new Uint8Array(await blob.arrayBuffer()));
        await file.close();
    }

    export async function saveToFile(path: string[], baseDir: BaseDirectory, content: ISerializable) {
        const writer = new BinaryWriter(64);
        content.save(writer);
        if (writer.getBuffer().byteLength === 0) return;
        await writeFile(await join(...path), new Uint8Array(writer.getBuffer()), {baseDir});
    }

    export async function loadFromFile(path: string[], baseDir: BaseDirectory, content: ISerializable) {
        const data = await readFile(await join(...path), {baseDir});
        if (data.length === 0) return;
        const reader = new BinaryReader(data.buffer);
        content.load(reader);
    }

    export async function getUniqueFileName(originName: string, type: FileType, path: string): Promise<string> {
        let files: string[];
        try {
            const entries = await readDir(path, {baseDir: BaseDirectory.AppData});
            files = entries
                .filter(entry => entry.isFile && entry.name.length > 0)
                .map(entry => entry.name || '');
        } catch (error) {
            console.error(`Error reading directory: ${error}`);
            return originName;
        }

        let candidateName = `${originName}.${type}`;
        let counter = 0;

        while (files.includes(candidateName)) {
            counter += 1;
            candidateName = `${originName} ${counter}.${type}`;
        }

        return candidateName;
    }
}
