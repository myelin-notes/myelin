/**
 * The seam between the editor/app code and the host platform (Tauri today, a
 * web host later). Required members are primitives every host must provide;
 * the optional members are capabilities — their absence IS the signal that a
 * feature is unavailable, and UI affordances are gated on presence.
 *
 * Capability interfaces are high-level feature contracts (e.g. PDF export owns
 * destination picking), not emulations of any particular host API.
 */

import type {
  RunCodeRequest,
  RunFinishedEvent,
  RunOutputEvent,
} from '../code-runner/contract';
import type { PdfExportRequest } from '../pdf-export/contract';
import type { LiveDiscoveryTransport } from '../sync/live/transport';
import type { VFSNodeId } from '../sync/types';

export type Unsubscribe = () => void;

export interface SaveFileFilter {
  name: string;
  extensions: string[];
}

export interface SaveFileOptions {
  /** Suggested file name, including extension. */
  suggestedName: string;
  filter?: SaveFileFilter;
  /**
   * May be a promise so callers can overlap serialization with the user's
   * destination pick; it is awaited only after a destination is confirmed.
   */
  data: string | Uint8Array | Promise<string | Uint8Array>;
}

export interface SaveFileResult {
  /** The user dismissed the destination picker — a no-op, not an error. */
  cancelled: boolean;
}

/**
 * Store for locally-derived, hash/id-keyed artifacts (thumbnails). Redundant
 * per client: losing it only costs regeneration.
 */
export interface ArtifactCache {
  /** A URL renderable in the webview for a cached artifact, or null when absent. */
  getUrl(path: string): Promise<string | null>;
  write(path: string, data: Blob): Promise<void>;
  /** Remove a file or directory (recursively). Missing paths are a no-op. */
  remove(path: string): Promise<void>;
}

export interface AudioTranscriptionSession {
  /** Resolves with the full transcript once the backend flushes its final segments. */
  finish(): Promise<string>;
}

export interface TranscriptionCapability {
  /**
   * Start a live transcription session fed by a microphone stream. Resolves
   * null when the backend is unavailable (the session never opened).
   */
  startSession(options: {
    elementId: string;
    stream: MediaStream;
  }): Promise<AudioTranscriptionSession | null>;
  /**
   * Transcribe an already-decoded audio file (the import / retry path).
   * Resolves null when the backend is unavailable, '' when no speech was heard.
   */
  transcribeBuffer(
    elementId: string,
    buffer: AudioBuffer,
  ): Promise<string | null>;
}

/** One reindex/recognition request, as passed to the host engine. */
export interface ReindexItem {
  nodeId: VFSNodeId;
  path: string;
  fileType: string;
}

export interface NoteEmbedding {
  model: string;
  dim: number;
  vector: number[];
}

export interface NoteIndexCapability {
  /** Point the index at a repository. Pair with {@link reset} on teardown. */
  init(repoId: string): Promise<void>;
  reset(): void;
  /** The synchronous index corpus, keyed by node id, for the search layer. */
  getContent(): ReadonlyMap<VFSNodeId, string>;
  getEmbeddings(): ReadonlyMap<VFSNodeId, NoteEmbedding>;
  embedSearchQuery(query: string): Promise<NoteEmbedding>;
  /** Queue a single note for (debounced) reindexing. */
  requestReindex(nodeId: VFSNodeId, path: string, fileType: string): void;
  /** Hand the engine a batch of stale/missing candidates (startup backfill). */
  startBackfill(items: ReindexItem[]): void;
  removeIndex(nodeId: VFSNodeId): Promise<void>;
}

/**
 * Recognized handwriting for one node. Each line carries the recognized
 * `text` plus the strokes it came from, so canvas search can match
 * handwriting and navigate to it.
 */
export interface RecognizedPage {
  nodeId: VFSNodeId;
  sourceHash: string;
  schemaVersion: number;
  lines: RecognizedLine[];
  updatedAt: number;
}

export interface RecognizedLine {
  text: string;
  /** `[x, y, w, h]` in canvas coordinates. */
  bbox: [number, number, number, number];
  strokeIds: string[];
  hash: string;
}

export interface HandwritingCapability {
  /** Point recognition at a repository. Pair with {@link reset} on teardown. */
  init(repoId: string): void;
  reset(): void;
  /** Queue a single note for (debounced) handwriting recognition. */
  requestRecognize(nodeId: VFSNodeId, path: string, fileType: string): void;
  /** Hand the engine a batch of candidates (startup backfill). */
  startBackfill(items: ReindexItem[]): void;
  /** A node's recognized handwriting, or null if it has none yet. */
  readPage(nodeId: VFSNodeId): Promise<RecognizedPage | null>;
  removeRecognition(nodeId: VFSNodeId): Promise<void>;
}

export interface CodeRunnerCapability {
  runCode(request: RunCodeRequest): Promise<void>;
  cancelRun(executionId: string): Promise<void>;
  /** Streams stdout/stderr lines for one execution. Await before {@link runCode}. */
  onRunOutput(
    executionId: string,
    callback: (event: RunOutputEvent) => void,
  ): Promise<Unsubscribe>;
  /** Fires once when an execution exits (or fails to start). */
  onRunFinished(
    executionId: string,
    callback: (event: RunFinishedEvent) => void,
  ): Promise<Unsubscribe>;
}

export interface PdfExportOptions {
  /** Suggested file name, including the .pdf extension. */
  suggestedName: string;
  /**
   * Builds the display list. Called only after the user confirms a
   * destination, so cancelling stays cheap. Return null to abort the export
   * (nothing is written and the result reports `cancelled`).
   */
  buildRequest(): Promise<PdfExportRequest | null>;
}

export interface PdfExportCapability {
  /** Pick a destination and write the rendered PDF there. */
  export(options: PdfExportOptions): Promise<{ cancelled: boolean }>;
}

export interface Platform {
  saveFile(options: SaveFileOptions): Promise<SaveFileResult>;
  openExternal(url: string): Promise<void>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  artifactCache: ArtifactCache;
  /** Persist serialized log lines — the logger's sink. */
  writeLogs(lines: string[]): Promise<void>;
  /** Subscribe to a host-emitted event by name. */
  subscribeEvent<T>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<Unsubscribe>;
  transcription?: TranscriptionCapability;
  handwriting?: HandwritingCapability;
  codeRunner?: CodeRunnerCapability;
  pdfExport?: PdfExportCapability;
  noteIndex?: NoteIndexCapability;
  createLiveTransport?(noteId: VFSNodeId): LiveDiscoveryTransport;
}
