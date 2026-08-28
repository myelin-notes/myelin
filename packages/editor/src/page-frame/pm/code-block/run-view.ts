import type { EditorView } from 'prosemirror-view';
import { trackEvent } from '@myelin/shared/analytics';
import { Logger } from '@myelin/shared/logger';
import type {
  RunnableLanguage,
  RunPollResponse,
} from '../../../code-runner/contract';
import { type CodeRunnerCapability, getPlatform } from '../../../platform';
import type { RunSource } from './concat';
import { codeRunStore } from './run-store';

const logger = new Logger('CodeBlockRun');

/** Pull cadence while a run is quiet. Each poll is one bounded IPC round-trip,
 *  so output can never flood the webview faster than this. */
const POLL_INTERVAL_MS = 50;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface CodeBlockRunViewOptions {
  view: EditorView;
  /** The node view's outer DOM, used to anchor the output overlay. */
  blockDom: HTMLElement;
  /** Builds the concatenated run payload for this block at click time. */
  collectSource: () => RunSource | null;
}

/**
 * A code block's Run/Stop button, overlaid in the top-right corner. Absolutely positioned, so it
 * never changes the block's measured size. Output (including a non-zero exit code) is pushed to
 * {@link codeRunStore} and rendered by the React overlay layer.
 */
export class CodeBlockRunView {
  /** Appended into the node view's DOM as a top-right absolute overlay. */
  public readonly button: HTMLButtonElement;

  /** Stable identity for this block's overlay entry in the store. */
  private readonly id = crypto.randomUUID();

  private language: RunnableLanguage | null = null;
  private executionId: string | null = null;
  private running = false;
  /** Run context captured at start, reported when the run finishes. */
  private runLanguage: RunnableLanguage | null = null;
  private runStartedAt = 0;
  private runCancelled = false;

  constructor(private readonly options: CodeBlockRunViewOptions) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pm-code-block__run-btn';
    this.button.style.display = 'none';
    this.button.addEventListener('click', () => this.toggleRun());
    this.syncButton();
  }

  // Shown only for languages with a local runner, and only when this platform can run code at all.
  setLanguage(language: RunnableLanguage | null): void {
    if (language === this.language) {
      return;
    }
    this.language = language;
    this.button.style.display =
      language && getPlatform().codeRunner ? '' : 'none';
  }

  dispose(): void {
    const executionId = this.executionId;
    // Nulling the id stops the poll loop.
    this.executionId = null;
    const codeRunner = getPlatform().codeRunner;
    if (executionId && codeRunner) {
      void codeRunner
        .cancelRun(executionId)
        .catch(() => {})
        .then(() => codeRunner.releaseRun(executionId))
        .catch(() => {});
    }
    codeRunStore.remove(this.id);
  }

  private toggleRun(): void {
    if (this.running) {
      if (this.executionId) {
        this.runCancelled = true;
        void getPlatform()
          .codeRunner?.cancelRun(this.executionId)
          .catch((err) => logger.error('cancel_run failed', err));
      }
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    const codeRunner = getPlatform().codeRunner;
    if (!codeRunner) {
      return;
    }
    const payload = this.options.collectSource();
    if (!payload) {
      return;
    }

    const executionId = crypto.randomUUID();
    this.executionId = executionId;
    this.runLanguage = payload.language;
    this.runStartedAt = Date.now();
    this.runCancelled = false;
    this.setRunning(true);
    codeRunStore.start(this.id, this.options.view, this.options.blockDom);

    try {
      await codeRunner.runCode({
        executionId,
        language: payload.language,
        source: payload.source,
      });
    } catch (err) {
      this.onFinished(null, String(err));
      return;
    }
    void this.pollLoop(codeRunner, executionId);
  }

  /** Drains the backend's output ring at its own pace until the run finishes,
   *  this view is disposed, or a new run replaces `executionId`. */
  private async pollLoop(
    codeRunner: CodeRunnerCapability,
    executionId: string,
  ): Promise<void> {
    let cursor = 0;
    while (this.executionId === executionId) {
      let res: RunPollResponse;
      try {
        res = await codeRunner.pollOutput(executionId, cursor);
      } catch (err) {
        if (this.executionId === executionId) {
          this.onFinished(null, String(err));
        }
        return;
      }
      if (this.executionId !== executionId) {
        return;
      }

      if (res.skipped > 0) {
        codeRunStore.appendLine(this.id, {
          text: `… ${res.skipped} lines skipped`,
          stream: 'stderr',
        });
      }
      codeRunStore.appendLines(this.id, res.lines);
      cursor = res.nextCursor;

      if (res.finished) {
        if (res.lines.length === 0) {
          void codeRunner.releaseRun(executionId).catch(() => {});
          this.onFinished(res.exitCode, res.error);
          return;
        }
        // Process already exited — drain the remaining backlog without delay.
        continue;
      }
      await delay(POLL_INTERVAL_MS);
    }
  }

  private onFinished(exitCode: number | null, error: string | null): void {
    this.executionId = null;
    this.setRunning(false);

    if (error) {
      codeRunStore.appendLine(this.id, { text: error, stream: 'stderr' });
    } else if (exitCode !== 0) {
      codeRunStore.appendLine(this.id, {
        text: `Process exited with code ${exitCode}`,
        stream: 'stderr',
      });
    }

    const outcome = this.runCancelled
      ? 'cancelled'
      : error || exitCode !== 0
        ? 'error'
        : 'success';
    trackEvent('code_run_finished', {
      language: this.runLanguage,
      outcome,
      exit_code: exitCode,
      duration_ms: Date.now() - this.runStartedAt,
    });
  }

  private setRunning(running: boolean): void {
    this.running = running;
    this.syncButton();
  }

  private syncButton(): void {
    this.button.textContent = this.running ? '■' : '▶';
    this.button.setAttribute('aria-label', this.running ? 'Stop' : 'Run');
  }
}
