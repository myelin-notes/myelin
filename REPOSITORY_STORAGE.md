# Repository storage

Repository metadata lives in `files/<node-id>.meta.json`, including folders and version-history nodes. Content keeps its existing ID-based filename and encoding. The app reconstructs its in-memory library from these records; search indexes remain rebuildable caches.

JavaScript saves patches containing only affected nodes or repository settings. Local edits serialize and journal only dirty records; sync reuses unchanged sidecars in its cache. Read-only library snapshots still assemble the records in memory.

A live sidecar contains `version: 1`, `node`, `links`, and an optional `restoredFrom` deletion revision. A deletion replaces the sidecar with `version: 1`, `id`, `deleted: true`, and `deletionId`. Keep these tombstones: an offline client must not resurrect deleted IDs. Unsynced content edits to deleted files become recovery copies with new IDs.

`repository.json` stores repository-wide settings, with `version: 1`. Its `generation` changes after cloud uploads so readers can detect an overlapping sync. It contains no node listing. `manifest.json` is the constant marker `{"version":4}`: version 4 identifies sidecar storage, and omitting `nodes` makes older clients reject it. The library can be reconstructed when this marker is missing or corrupt.

## Automatic migration

Legacy decoding, schema conversion, and old journal replay are isolated in `src-tauri/src/repository_metadata/legacy.rs`. New repositories start in the sidecar format; bootstrap downloads never create a legacy manifest.

Local open first replays any legacy recovery journal, validates the legacy metadata, and preserves the original manifest as `manifest.legacy.json`. It journals the new records and writes the upgrade marker last. Interrupted migration resumes from that journal. Later writes journal only changed metadata and changed local sync state.

The first cloud sync migrates an existing repository even without local edits. GitHub publishes the sidecars, settings, backup, and marker in one commit. Google Drive stages complete metadata files while the legacy manifest remains authoritative, then publishes the settings and upgrade marker. Retries reuse staged files; records removed by an older client during an interrupted migration become tombstones. Content is uploaded before its metadata and deleted after its tombstone.

`manifest.legacy.json` is a metadata snapshot at migration time, not a backup of later edits or of all content bytes. It is preserved rather than updated. Every device using a migrated repository must run an app version supporting sidecars.

## Recovery

Malformed local records are moved to `metadata.corrupt.*.json`. Healthy notes remain usable, and children of missing folders appear at the root. Corrupt cloud metadata imports healthy records and retains cached content without uploading changes. A missing previously published sidecar is treated as a recovery problem; deletion requires a tombstone.

Sync pauses with a recovery message and a local `.native-recovery-error` file. To resume, close Myelin, repair the affected local and/or cloud records, remove that local recovery marker, and reopen. Preserve the quarantined files when repairing them. A corrupt upgrade marker alone is rebuilt automatically.
