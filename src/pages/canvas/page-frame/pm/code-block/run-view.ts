import type { EditorView } from 'prosemirror-view';
import type { UnlistenFn } from '@tauri-apps/api/event';
import {
  cancelRun,
  onRunFinished,
  onRunOutput,
  runCode,
} from '@/lib/code-runner/client';
import type { RunnableLanguage } from '@/lib/code-runner/contract';
import { Logger } from '@/lib/logger';
import type { RunSource } from './concat';
import { codeRunStore } from './run-store';

const logger = new Logger('CodeBlockRun');

interface CodeBlockRunViewOptions {
  view: EditorView;
  /** The node view's outer DOM, used to anchor the output overlay. */
  blockDom: HTMLElement;
  /** Builds the concatenated run payload for this block at click time. */
  collectSource: () => RunSource | null;
}

type RunStatus = 'idle' | 'running' | 'ok' | 'error';

/**
 * Owns a code block's run affordance: a Run/Stop button overlaid in the block's
 * top-right corner, plus a status label. The chip is absolutely positioned, so
 * it never changes the block's measured size. Output is pushed to
 * {@link codeRunStore} and rendered by the React overlay layer.
 */
export class CodeBlockRunView {
  /** Appended into the node view's DOM as a top-right absolute overlay. */
  public readonly chip: HTMLDivElement;

  private readonly runButton: HTMLButtonElement;
  /** Stable identity for this block's overlay entry in the store. */
  private readonly id = crypto.randomUUID();

  private language: RunnableLanguage | null = null;
  private executionId: string | null = null;
  private status: RunStatus = 'idle';

  private unlistenOutput: UnlistenFn | null = null;
  private unlistenFinished: UnlistenFn | null = null;

  constructor(private readonly options: CodeBlockRunViewOptions) {
    this.chip = document.createElement('div');
    this.chip.className = 'pm-code-block__run-bar';
    this.chip.style.display = 'none';

    this.runButton = document.createElement('button');
    this.runButton.type = 'button';
    this.runButton.className = 'pm-code-block__run-btn';
    this.runButton.addEventListener('click', () => this.toggleRun());

    this.chip.append(this.runButton);
    this.syncChip();
  }

  /** Show the chip only for languages with a local runner. */
  setLanguage(language: RunnableLanguage | null): void {
    if (language === this.language) {
      return;
    }
    this.language = language;
    this.chip.style.display = language ? '' : 'none';
  }

  dispose(): void {
    if (this.executionId) {
      void cancelRun(this.executionId).catch(() => {});
    }
    this.clearListeners();
    codeRunStore.remove(this.id);
  }

  private toggleRun(): void {
    if (this.status === 'running') {
      if (this.executionId) {
        void cancelRun(this.executionId).catch((err) =>
          logger.error('cancel_run failed', err),
        );
      }
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    const payload = this.options.collectSource();
    if (!payload) {
      return;
    }

    const executionId = crypto.randomUUID();
    this.executionId = executionId;
    this.setStatus('running');
    codeRunStore.start(this.id, this.options.view, this.options.blockDom);

    // Subscribe before invoking so a fast-exiting process can't emit before a
    // listener exists.
    this.unlistenOutput = await onRunOutput(executionId, (event) => {
      codeRunStore.appendLines(
        this.id,
        event.lines.map((text) => ({ text, stream: event.stream })),
      );
    });
    this.unlistenFinished = await onRunFinished(executionId, (event) => {
      this.onFinished(event.exitCode, event.error);
    });

    try {
      await runCode({
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

    if (error) {
      codeRunStore.appendLine(this.id, { text: error, stream: 'stderr' });
      codeRunStore.setStatus(this.id, 'error');
      this.setStatus('error');
    } else if (exitCode === 0) {
      codeRunStore.setStatus(this.id, 'ok');
      this.setStatus('ok');
    } else {
      codeRunStore.appendLine(this.id, {
        text: `Process exited with code ${exitCode}`,
        stream: 'stderr',
      });
      codeRunStore.setStatus(this.id, 'error');
      this.setStatus('error');
    }
  }

  private setStatus(status: RunStatus): void {
    this.status = status;
    this.syncChip();
  }

  private syncChip(): void {
    const running = this.status === 'running';
    this.runButton.textContent = running ? '■' : '▶';
    this.runButton.setAttribute('aria-label', running ? 'Stop' : 'Run');
    this.runButton.classList.toggle('is-running', running);
  }

  private clearListeners(): void {
    this.unlistenOutput?.();
    this.unlistenFinished?.();
    this.unlistenOutput = null;
    this.unlistenFinished = null;
  }
}
