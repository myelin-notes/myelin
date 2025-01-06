import {BaseDirectory, exists, mkdir, readDir, remove, rename, stat, writeFile} from "@tauri-apps/plugin-fs";
import {basename, dirname, extname} from "@tauri-apps/api/path";

export const FileTypes = ['mcanvas', 'mdoc'] as const;
export type FileType = typeof FileTypes[number];

export interface MyelinFile {
    // A URL To the preview image
    preview: string;
    name: string;
    type: FileType;
}

export namespace FileSystem {
    export async function load(path: string[]): Promise<[string[], MyelinFile[]]> {
        const pathJoined = path.join("/");

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

                files.push(parseFile(pathJoined, name, ext));
            }
        }

        return [dirs, files];
    }

    export async function deleteFileOrFolder(path: string) {
        await remove(path, {baseDir: BaseDirectory.AppData, recursive: true});
    }

    export async function renameFileOrFolder(path: string, to: string) {
        const pathTo = await dirname(path);

        if ((await stat(path, {baseDir: BaseDirectory.AppData})).isFile) {
            const ext = await extname(path);
            await rename(path, `${pathTo}/${to}.${ext}`, {
                oldPathBaseDir: BaseDirectory.AppData,
                newPathBaseDir: BaseDirectory.AppData
            });
            return;
        }

        await rename(path, `${pathTo}/${to}`, {
            oldPathBaseDir: BaseDirectory.AppData,
            newPathBaseDir: BaseDirectory.AppData
        });
    }

    export function isValidFileType(str: unknown): str is FileType {
        // @ts-ignore
        return typeof str === "string" && FileTypes.includes(str);
    }

    export function parseFile(path: string, name: string, ext: FileType): MyelinFile {
        return {
            preview: path + `/${name}.png`,
            name: name,
            type: ext,
        };
    }

    export async function createFile(path: string, name: string, content: ArrayBuffer) {
        await writeFile(`${path}/${name}`, new Uint8Array(content), {baseDir: BaseDirectory.AppData});
    }

    /**
     * Generates a unique file name by appending a number to the base name if needed.
     * @param originName - The original name of the file (e.g., "OriginName").
     * @param path - The directory path where the file is located.
     * @returns The first available unique file name.
     */
    export async function getUniqueFileName(originName: string, type: FileType, path: string): Promise<string> {
        // Fetch all file names in the directory once
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

        // Check availability using in-memory list
        let candidateName = `${originName}.${type}`;
        let counter = 0;

        while (files.includes(candidateName)) {
            counter += 1;
            candidateName = `${originName} ${counter}.${type}`;
        }

        return candidateName;
    }
}