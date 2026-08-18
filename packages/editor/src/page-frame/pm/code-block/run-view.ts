import type { EditorView } from 'prosemirror-view';
import { trackEvent } from '@myelin/shared/analytics';
import { Logger } from '@myelin/shared/logger';
import {
  parseDisplayPayload,
  type RunnableLanguage,
} from '../../../code-runner/contract';
import { getPlatform, type Unsubscribe } from '../../../platform';
import type { RunSource } from './concat';
import { type CodeRunItem, codeRunStore } from './run-store';

const logger = new Logger('CodeBlockRun');

interface CodeBlockRunViewOptions {
  view: EditorView;
  /** The node view's outer DOM, used to anchor the output overlay. */
  blockDom: HTMLElement;
  /** Builds the concatenated run payload for this block at click time. */
  collectSource: () => RunSource | null;
}

/**
 * Owns a code block's run affordance: a Run/Stop button overlaid in the block's
 * top-right corner. The button is absolutely positioned, so it never changes
 * the block's measured size. Output (including a non-zero exit code) is pushed
 * to {@link codeRunStore} and rendered by the React overlay layer.
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

  private unlistenOutput: Unsubscribe | null = null;
  private unlistenFinished: Unsubscribe | null = null;

  constructor(private readonly options: CodeBlockRunViewOptions) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pm-code-block__run-btn';
    this.button.style.display = 'none';
    this.button.addEventListener('click', () => this.toggleRun());
    this.syncButton();
  }

  /**
   * Show the button only for languages with a local runner, and only when
   * this platform can run code at all.
   */
  setLanguage(language: RunnableLanguage | null): void {
    if (language === this.language) {
      return;
    }
    this.language = language;
    this.button.style.display =
      language && getPlatform().codeRunner ? '' : 'none';
  }

  dispose(): void {
    if (this.executionId) {
      void getPlatform()
        .codeRunner?.cancelRun(this.executionId)
        .catch(() => {});
    }
    this.clearListeners();
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

    // Subscribe before invoking so a fast-exiting process can't emit before a
    // listener exists.
    this.unlistenOutput = await codeRunner.onRunOutput(executionId, (event) => {
      codeRunStore.appendItems(
        this.id,
        event.lines.map((text) => toItem(text, event.stream)),
      );
    });
    this.unlistenFinished = await codeRunner.onRunFinished(
      executionId,
      (event) => {
        this.onFinished(event.exitCode, event.error);
      },
    );

    try {
      await codeRunner.runCode({
        executionId,
        language: payload.language,
        source: payload.source,
      });
    } catch (err) {
      this.onFinished(null, String(err));
    }
  }

  private onFinished(exitCode: number | null, error: string | null): void {
    this.clearListeners();
    this.executionId = null;
    this.setRunning(false);

    if (error) {
      codeRunStore.appendItem(this.id, {
        kind: 'text',
        text: error,
        stream: 'stderr',
      });
    } else if (exitCode !== 0) {
      codeRunStore.appendItem(this.id, {
        kind: 'text',
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

  private clearListeners(): void {
    this.unlistenOutput?.();
    this.unlistenFinished?.();
    this.unlistenOutput = null;
    this.unlistenFinished = null;
  }
}

/**
 * Turns one output line into a store item. Rich payloads ride on stdout inside
 * a sentinel (see {@link parseDisplayPayload}); everything else is text.
 */
function toItem(text: string, stream: 'stdout' | 'stderr'): CodeRunItem {
  if (stream === 'stdout') {
    const payload = parseDisplayPayload(text);
    if (payload) {
      return { kind: 'display', payload };
    }
  }
  return { kind: 'text', text, stream };
}
