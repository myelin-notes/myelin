import {BaseDirectory, exists, mkdir, readDir, writeFile} from "@tauri-apps/plugin-fs";

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
                const n = entry.name;
                const i = n.lastIndexOf('.');
                const ext = n.substring(i + 1);
                const name = n.substring(0, i);
                if (!isValidFileType(ext)) {
                    continue;
                }

                files.push(parseFile(pathJoined, name, ext));
            }
        }

        return [dirs, files];
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

    export async function createFile(path: string, name: string, type: FileType, content: ArrayBuffer) {
        await writeFile(`${path}/${name}.${type}`, new Uint8Array(content), {baseDir: BaseDirectory.AppData});
    }
}