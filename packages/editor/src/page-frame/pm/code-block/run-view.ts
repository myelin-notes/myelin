import type { EditorView } from 'prosemirror-view';
import { trackEvent } from '@myelin/shared/analytics';
import { Logger } from '@myelin/shared/logger';
import type {
  RunnableLanguage,
  RunPollResponse,
} from '../../../code-runner/contract';
import { codeOutputBridge } from '../../../elements/code-output/bridge';
import type { CodeOutputItem } from '../../../elements/code-output/element';
import { type CodeRunnerCapability, getPlatform } from '../../../platform';
import { PM_EDITOR_CLASS } from '../constants';
import { getPageFramePmScreenRectForElement } from '../screen-rect';
import type { RunSource } from './concat';
import { codeRunStore } from './run-store';

const logger = new Logger('CodeBlockRun');

/** Pull cadence while a run is quiet. Each poll is one bounded IPC round-trip,
 *  so output can never flood the webview faster than this. */
const POLL_INTERVAL_MS = 50;

/** Lines kept when a finished run settles into the card's persisted (synced, saved) state. */
const MAX_PERSISTED_LINES = 2000;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface CodeBlockRunViewOptions {
  view: EditorView;
  /** The node view's outer DOM, used to anchor the output card's spawn position. */
  blockDom: HTMLElement;
  getPos: () => number;
  /** Builds the concatenated run payload for this block at click time. */
  collectSource: () => RunSource | null;
}

/**
 * A code block's Run/Stop button, overlaid in the top-right corner. Absolutely positioned, so it
 * never changes the block's measured size. Output streams to {@link codeRunStore} (rendered live
 * by the block's canvas output card) and settles into the card element when the run finishes.
 */
export class CodeBlockRunView {
  /** Appended into the node view's DOM as a top-right absolute overlay. */
  public readonly button: HTMLButtonElement;

  private language: RunnableLanguage | null = null;
  private executionId: string | null = null;
  private running = false;
  /** The block's stable id, minted on first run; keys the store session and the output card. */
  private blockId: string | null = null;
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
    if (this.blockId) {
      codeRunStore.remove(this.blockId);
    }
  }

  private toggleRun(): void {
    if (this.running) {
      this.cancelRun();
      return;
    }
    void this.run();
  }

  private cancelRun(): void {
    if (!this.running || !this.executionId) {
      return;
    }
    this.runCancelled = true;
    void getPlatform()
      .codeRunner?.cancelRun(this.executionId)
      .catch((err) => logger.error('cancel_run failed', err));
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
    const blockId = this.ensureBlockId();
    if (!blockId) {
      return;
    }

    const executionId = crypto.randomUUID();
    this.executionId = executionId;
    this.blockId = blockId;
    this.runLanguage = payload.language;
    this.runStartedAt = Date.now();
    this.runCancelled = false;
    this.setRunning(true);

    codeRunStore.start(blockId, payload.language, () => this.cancelRun());
    const frameUuid = this.frameUuid();
    if (frameUuid) {
      codeOutputBridge.ensureCard({
        frameUuid,
        blockId,
        blockScreenRect: getPageFramePmScreenRectForElement(
          this.options.view,
          this.options.blockDom,
        ),
        pageLayout: this.pageLayout(),
      });
    }

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
    const blockId = this.blockId;
    if (!blockId) {
      return;
    }
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
        codeRunStore.appendLine(blockId, {
          text: `… ${res.skipped} lines skipped`,
          stream: 'stderr',
        });
      }
      codeRunStore.appendLines(blockId, res.lines);
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
    const blockId = this.blockId;
    if (!blockId) {
      return;
    }

    if (error) {
      codeRunStore.appendLine(blockId, { text: error, stream: 'stderr' });
    } else if (exitCode !== 0) {
      codeRunStore.appendLine(blockId, {
        text: `Process exited with code ${exitCode}`,
        stream: 'stderr',
      });
    }

    const durationMs = Date.now() - this.runStartedAt;
    const frameUuid = this.frameUuid();
    const lines = codeRunStore.getSession(blockId)?.lines ?? [];
    if (frameUuid && this.runLanguage) {
      const kept = lines.slice(-MAX_PERSISTED_LINES);
      const items: CodeOutputItem[] = kept.map((line) => ({
        kind: 'text',
        stream: line.stream,
        text: line.text,
      }));
      codeOutputBridge.settle({
        frameUuid,
        blockId,
        items,
        truncated: lines.length - kept.length,
        runMeta: {
          language: this.runLanguage,
          exitCode,
          durationMs,
          finishedAt: Date.now(),
          error,
          cancelled: this.runCancelled,
        },
      });
    }
    // The card now renders the settled items; drop the live session.
    codeRunStore.remove(blockId);

    const outcome = this.runCancelled
      ? 'cancelled'
      : error || exitCode !== 0
        ? 'error'
        : 'success';
    trackEvent('code_run_finished', {
      language: this.runLanguage,
      outcome,
      exit_code: exitCode,
      duration_ms: durationMs,
    });
  }

  /** Reads the block's stable id, minting one into the node's attrs on first run. */
  private ensureBlockId(): string | null {
    const { view, getPos } = this.options;
    const pos = getPos();
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') {
      return null;
    }
    const existing = node.attrs.blockId;
    if (typeof existing === 'string' && existing.length > 0) {
      return existing;
    }
    const blockId = crypto.randomUUID();
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, blockId }),
    );
    return blockId;
  }

  private editorHost(): HTMLElement | null {
    return this.options.view.dom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  }

  private frameUuid(): string | null {
    return this.editorHost()?.dataset.frameUuid ?? null;
  }

  private pageLayout(): string {
    return this.editorHost()?.getAttribute('data-page-layout') ?? 'vertical';
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
