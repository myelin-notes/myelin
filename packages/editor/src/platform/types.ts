/**
 * The seam between editor/app code and the host platform. Required members are primitives every
 * host must provide; the absence of an optional member IS the signal that a feature is
 * unavailable, and UI affordances are gated on presence.
 */

import type { RunCodeRequest, RunPollResponse } from '../code-runner/contract';
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
   * May be a promise so callers can overlap serialization with the destination pick; awaited only
   * after a destination is confirmed.
   */
  data: string | Uint8Array | Promise<string | Uint8Array>;
}

export interface SaveFileResult {
  /** The user dismissed the destination picker — a no-op, not an error. */
  cancelled: boolean;
}

/** Redundant per client: losing it only costs regeneration. */
export interface ArtifactCache {
  /** A URL renderable in the webview for a cached artifact, or null when absent. */
  getUrl(path: string): Promise<string | null>;
  /** The cached artifact bytes, or null when absent. */
  read(path: string): Promise<Blob | null>;
  write(path: string, data: Blob): Promise<void>;
  /** Remove a file or directory (recursively). Missing paths are a no-op. */
  remove(path: string): Promise<void>;
}

/** One whisper segment. Times are seconds from the start of the recording. */
export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface AudioTranscriptionSession {
  /**
   * Resolves once the backend flushes its final segments, however long whisper takes. Settles
   * early only on cancel or when the backend reports the session finished.
   */
  finish(): Promise<TranscriptSegment[]>;
  /**
   * Anchors segment times to a file recorded alongside this session: call it the instant recording
   * starts. Mic capture opens first, so without this every segment lands early by that gap.
   * A buffer session ignores it — its samples already share the file's timeline.
   */
  markRecordingStart(): void;
  /** Stops capture, aborts any in-flight whisper run, discards the transcript, settles a pending finish(). */
  cancel(): Promise<void>;
}

export interface TranscriptionCapability {
  /** Resolves null when the backend is unavailable (the session never opened). */
  startSession(options: {
    elementId: string;
    stream: MediaStream;
  }): Promise<AudioTranscriptionSession | null>;
  /**
   * The import / retry path. Resolves null when the backend is unavailable. The caller awaits
   * `finish()` and can `cancel()` while it is pending (e.g. element deleted mid-transcription).
   */
  startBufferSession(
    elementId: string,
    buffer: AudioBuffer,
  ): Promise<AudioTranscriptionSession | null>;
}

export interface CodeRunnerCapability {
  runCode(request: RunCodeRequest): Promise<void>;
  cancelRun(executionId: string): Promise<void>;
  /** Buffered output since `cursor` for one execution; rejects if unknown. */
  pollOutput(executionId: string, cursor: number): Promise<RunPollResponse>;
  /** Frees the backend's output buffer once a run has been drained. */
  releaseRun(executionId: string): Promise<void>;
}

export interface PdfExportOptions {
  /** Suggested file name, including the .pdf extension. */
  suggestedName: string;
  /**
   * Called only after the user confirms a destination, so cancelling stays cheap. Return null to
   * abort the export (nothing written, result reports `cancelled`).
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
  /** Subscribe to a host-emitted event by name. */
  subscribeEvent<T>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<Unsubscribe>;
  transcription?: TranscriptionCapability;
  codeRunner?: CodeRunnerCapability;
  pdfExport?: PdfExportCapability;
  createLiveTransport?(noteId: VFSNodeId): LiveDiscoveryTransport;
}
