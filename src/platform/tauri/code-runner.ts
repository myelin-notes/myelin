import type { RunPollResponse } from '@myelin/editor/code-runner/contract';
import type { CodeRunnerCapability } from '@myelin/editor/platform/types';
import { invoke } from '@tauri-apps/api/core';

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

  pollOutput(executionId, cursor) {
    return invoke<RunPollResponse>('poll_output', { executionId, cursor });
  },

  releaseRun(executionId) {
    return invoke('release_run', { executionId });
  },
};
