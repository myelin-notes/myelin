# Repository storage

Repository metadata lives in `files/<node-id>.meta.json`, including folders and version-history nodes. Content keeps its existing ID-based filename and encoding, except that large media moves out of canvas documents (see [Media](#media)). The app reconstructs its in-memory library from these records; search indexes remain rebuildable caches.

JavaScript saves patches containing only affected nodes or repository settings. Local edits serialize and journal only dirty records; sync reuses unchanged sidecars in its cache. Read-only library snapshots still assemble the records in memory.

A live sidecar contains `version: 1`, `node`, `links`, and an optional `restoredFrom` deletion revision. A deletion replaces the sidecar with `version: 1`, `id`, `deleted: true`, and `deletionId`. Keep these tombstones: an offline client must not resurrect deleted IDs. Unsynced content edits to deleted files become recovery copies with new IDs.

`repository.json` stores repository-wide settings, with `version: 1`. Its `generation` changes after cloud uploads so readers can detect an overlapping sync. It contains no node listing. `manifest.json` is the constant marker `{"version":4}`: version 4 identifies sidecar storage, and omitting `nodes` makes older clients reject it. The library can be reconstructed when this marker is missing or corrupt.

## Media

Binary values of 64 KiB or more do not stay in canvas documents. Each is stored once as `files/<sha256>.media`, with a hidden node (`system.kind: "media"`) and a sidecar like any other file, so GitHub, Google Drive, first-time downloads and the journal need no special handling. The node is identical on every device (its ID is the hash and its timestamps are fixed), so two devices adding the same bytes cannot conflict.

In the document, the value's bytes become a reference: `\0myelin-media:` followed by the hex hash. Only the payload changes. Yjs struct IDs and lengths stay the same, so a copy holding references and a copy holding bytes are the same document and merge in either order. Version history copies documents, so a version now costs only its non-media data.

The swap happens at the storage boundary in `repository_engine`: `Store::read_file` restores media and `Store::commit` extracts it. The editor, MCP, live sync, export and version history always receive complete documents. The cost is that opening a canvas still loads all of its media into memory; loading it on demand would require the editor to understand references.

Remote files hold references. Sync extracts media after merging, uploads whatever the remote lacks, and restores media before passing a download to an open document.

### Failure behaviour

Media that is missing, or does not match its hash, leaves the reference in the document. The rest of the document stays usable and saving preserves the reference, so nothing is lost; the element appears broken until the document is reopened after the media arrives. A document that cannot be parsed or fails verification after extraction stays inline, which only costs space. A `.myelin` file copied by hand out of the repository folder holds references rather than media; use an export instead. A version's `byteLength` is the size of the complete document, not of its stored file.

### Upgrading existing repositories

After opening, a background pass rewrites documents that still hold inline media, one at a time, and queues them for upload. It keeps no state: documents below the size threshold cannot hold inline media and are skipped, and rewriting an already extracted document changes nothing.

Older app versions load references as corrupt media and show those elements blank. They keep references intact when saving, and anything they push with inline media is extracted by the next device running a current version. Update every device using a repository to avoid blank media.

### Cleanup

Media files are not deleted yet, so removing an element or letting its versions expire does not reclaim space. Cleanup must not delete media an offline device still references: a device can hold unsynced documents that point at a file another device considers unused, and applying that file's tombstone would destroy the only copy.

## Automatic migration

Legacy decoding, schema conversion, and old journal replay are isolated in `src-tauri/src/repository_metadata/legacy.rs`. New repositories start in the sidecar format; bootstrap downloads never create a legacy manifest.

Local open first replays any legacy recovery journal, validates the legacy metadata, and preserves the original manifest as `manifest.legacy.json`. It journals the new records and writes the upgrade marker last. Interrupted migration resumes from that journal. Later writes journal only changed metadata and changed local sync state.

The first cloud sync migrates an existing repository even without local edits. GitHub publishes the sidecars, settings, backup, and marker in one commit. Google Drive stages complete metadata files while the legacy manifest remains authoritative, then publishes the settings and upgrade marker. Retries reuse staged files; records removed by an older client during an interrupted migration become tombstones. Content is uploaded before its metadata and deleted after its tombstone.

`manifest.legacy.json` is a metadata snapshot at migration time, not a backup of later edits or of all content bytes. It is preserved rather than updated. Every device using a migrated repository must run an app version supporting sidecars.

## Recovery

Malformed local records are moved to `metadata.corrupt.*.json`. Healthy notes remain usable, and children of missing folders appear at the root. Corrupt cloud metadata imports healthy records and retains cached content without uploading changes. A missing previously published sidecar is treated as a recovery problem; deletion requires a tombstone.

Sync pauses with a recovery message and a local `.native-recovery-error` file. To resume, close Myelin, repair the affected local and/or cloud records, remove that local recovery marker, and reopen. Preserve the quarantined files when repairing them. A corrupt upgrade marker alone is rebuilt automatically.
