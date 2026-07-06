import type {
  RunFinishedEvent,
  RunOutputEvent,
} from '@myelin/editor/code-runner/contract';
import type { CodeRunnerCapability } from '@myelin/editor/platform/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const OUTPUT_EVENT = 'code-run-output';
const FINISHED_EVENT = 'code-run-finished';

export const codeRunner: CodeRunnerCapability = {
  /** Concatenated source is written to a temp file and run by the backend. */
  runCode(request) {
    return invoke('run_code', {
      executionId: request.executionId,
      language: request.language,
      source: request.source,
    });
  },

  cancelRun(executionId) {
    return invoke('cancel_run', { executionId });
  },

  onRunOutput(executionId, callback) {
    return listen<RunOutputEvent>(OUTPUT_EVENT, (event) => {
      if (event.payload.executionId === executionId) {
        callback(event.payload);
      }
    });
  },

  onRunFinished(executionId, callback) {
    return listen<RunFinishedEvent>(FINISHED_EVENT, (event) => {
      if (event.payload.executionId === executionId) {
        callback(event.payload);
      }
    });
  },
};
