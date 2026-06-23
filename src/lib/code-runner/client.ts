import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  RunFinishedEvent,
  RunnableLanguage,
  RunOutputEvent,
} from './contract';

const OUTPUT_EVENT = 'code-run-output';
const FINISHED_EVENT = 'code-run-finished';

export interface RunCodeRequest {
  executionId: string;
  language: RunnableLanguage;
  source: string;
}

/** Concatenated source is written to a temp file and run by the backend. */
export function runCode(request: RunCodeRequest): Promise<void> {
  return invoke('run_code', {
    executionId: request.executionId,
    language: request.language,
    source: request.source,
  });
}

export function cancelRun(executionId: string): Promise<void> {
  return invoke('cancel_run', { executionId });
}

/** Streams stdout/stderr lines for one execution. Await before {@link runCode}. */
export function onRunOutput(
  executionId: string,
  callback: (event: RunOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<RunOutputEvent>(OUTPUT_EVENT, (event) => {
    if (event.payload.executionId === executionId) {
      callback(event.payload);
    }
  });
}

/** Fires once when an execution exits (or fails to start). */
export function onRunFinished(
  executionId: string,
  callback: (event: RunFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RunFinishedEvent>(FINISHED_EVENT, (event) => {
    if (event.payload.executionId === executionId) {
      callback(event.payload);
    }
  });
}
