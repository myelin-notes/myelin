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
import { PM_EDITOR_CLASS } from '../constants';
import { getPageFramePmScreenRectForElement } from '../screen-rect';
import type { RunSource } from './concat';

const logger = new Logger('CodeBlockRun');

/** Gap between the block and its output overlay, in screen pixels. */
const ANCHOR_GAP = 12;
const EDGE_MARGIN = 12;

interface CodeBlockRunViewOptions {
  view: EditorView;
  /** The node view's outer DOM, used to anchor the overlay. */
  blockDom: HTMLElement;
  /** Builds the concatenated run payload for this block at click time. */
  collectSource: () => RunSource | null;
}

type RunStatus = 'idle' | 'running' | 'ok' | 'error';

/**
 * Owns a code block's run affordance: an in-flow status chip (Run/Stop button +
 * status) that lives inside the block, and a floating output overlay portaled
 * to document.body. The overlay is anchored beside the block (right for
 * vertical/continuous frames, below for horizontal — wherever the layout leaves
 * empty canvas) and tracks the canvas through pan/zoom via a rAF loop. Output
 * never enters the document flow, so it can't perturb pagination.
 */
export class CodeBlockRunView {
  /** Appended into the node view's DOM; height folds into the block measure. */
  public readonly chip: HTMLDivElement;

  private readonly runButton: HTMLButtonElement;
  private readonly statusEl: HTMLSpanElement;

  private overlay: HTMLDivElement | null = null;
  private outputBody: HTMLDivElement | null = null;

  private language: RunnableLanguage | null = null;
  private executionId: string | null = null;
  private status: RunStatus = 'idle';
  private rafId = 0;

  private unlistenOutput: UnlistenFn | null = null;
  private unlistenFinished: UnlistenFn | null = null;

  private readonly trackPosition = (): void => {
    this.positionOverlay();
    this.rafId = requestAnimationFrame(this.trackPosition);
  };

  constructor(private readonly options: CodeBlockRunViewOptions) {
    this.chip = document.createElement('div');
    this.chip.className = 'pm-code-block__run-bar';
    this.chip.style.display = 'none';

    this.runButton = document.createElement('button');
    this.runButton.type = 'button';
    this.runButton.className = 'pm-code-block__run-btn';
    this.runButton.addEventListener('click', () => this.toggleRun());

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'pm-code-block__run-status';

    this.chip.append(this.runButton, this.statusEl);
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

  /** Height the chip contributes to the block, for the node view's measure. */
  chipHeight(): number {
    return this.language ? this.chip.offsetHeight : 0;
  }

  dispose(): void {
    if (this.executionId) {
      void cancelRun(this.executionId).catch(() => {});
    }
    this.clearListeners();
    this.stopTracking();
    this.overlay?.remove();
    this.overlay = null;
    this.outputBody = null;
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
    this.showOverlay();
    this.clearOutput();

    // Subscribe before invoking so a fast-exiting process can't emit before a
    // listener exists.
    this.unlistenOutput = await onRunOutput(executionId, (event) => {
      this.appendLine(event.chunk, event.stream);
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
      this.appendLine(error, 'stderr');
      this.setStatus('error');
    } else if (exitCode === 0) {
      this.setStatus('ok', exitCode);
    } else {
      this.setStatus('error', exitCode);
    }
  }

  private setStatus(status: RunStatus, exitCode?: number | null): void {
    this.status = status;
    this.syncChip(exitCode);
  }

  private syncChip(exitCode?: number | null): void {
    const running = this.status === 'running';
    this.runButton.textContent = running ? '■' : '▶';
    this.runButton.setAttribute('aria-label', running ? 'Stop' : 'Run');
    this.runButton.classList.toggle('is-running', running);

    if (running) {
      this.statusEl.textContent = 'Running…';
    } else if (this.status === 'ok') {
      this.statusEl.textContent = 'Done';
    } else if (this.status === 'error') {
      this.statusEl.textContent =
        exitCode == null ? 'Error' : `Exit ${exitCode}`;
    } else {
      this.statusEl.textContent = '';
    }
    this.statusEl.classList.toggle(
      'is-error',
      this.status === 'error' && !running,
    );
  }

  private showOverlay(): void {
    if (!this.overlay) {
      this.buildOverlay();
    }
    if (this.overlay) {
      this.overlay.style.display = '';
      this.startTracking();
    }
  }

  private hideOverlay(): void {
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
    this.stopTracking();
  }

  private buildOverlay(): void {
    const overlay = document.createElement('div');
    overlay.className = 'pm-code-block__output';

    const header = document.createElement('div');
    header.className = 'pm-code-block__output-header';
    const title = document.createElement('span');
    title.textContent = 'Output';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pm-code-block__output-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Hide output');
    close.addEventListener('click', () => this.hideOverlay());
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'pm-code-block__output-body';

    overlay.append(header, body);
    // Keep canvas interactions (pan/zoom, selection clearing) from firing when
    // the user scrolls or clicks inside the floating output.
    overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
    overlay.addEventListener('wheel', (e) => e.stopPropagation());

    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.outputBody = body;
  }

  private clearOutput(): void {
    this.outputBody?.replaceChildren();
  }

  private appendLine(text: string, stream: 'stdout' | 'stderr'): void {
    if (!this.outputBody) {
      return;
    }
    const line = document.createElement('div');
    line.className = 'pm-code-block__output-line';
    if (stream === 'stderr') {
      line.classList.add('is-stderr');
    }
    // textContent, never innerHTML — program output is untrusted.
    line.textContent = text;
    this.outputBody.appendChild(line);
    this.outputBody.scrollTop = this.outputBody.scrollHeight;
  }

  private startTracking(): void {
    if (this.rafId) {
      return;
    }
    this.trackPosition();
  }

  private stopTracking(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private positionOverlay(): void {
    const overlay = this.overlay;
    if (!overlay) {
      return;
    }

    const rect = getPageFramePmScreenRectForElement(
      this.options.view,
      this.options.blockDom,
    );
    if (!rect) {
      overlay.style.display = 'none';
      return;
    }

    const width = overlay.offsetWidth;
    const height = overlay.offsetHeight;
    const horizontal = this.layout() === 'horizontal';

    // Each layout leaves an empty canvas band opposite its page-stacking axis:
    // vertical/continuous stack downward (room on the side), horizontal steps
    // sideways (room below).
    let left = horizontal ? rect.left : rect.right + ANCHOR_GAP;
    let top = horizontal ? rect.bottom + ANCHOR_GAP : rect.top;

    left = Math.max(
      EDGE_MARGIN,
      Math.min(left, window.innerWidth - width - EDGE_MARGIN),
    );
    top = Math.max(
      EDGE_MARGIN,
      Math.min(top, window.innerHeight - height - EDGE_MARGIN),
    );

    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
  }

  private layout(): string {
    const host = this.options.view.dom.closest(`.${PM_EDITOR_CLASS}`);
    return host?.getAttribute('data-page-layout') ?? 'vertical';
  }

  private clearListeners(): void {
    this.unlistenOutput?.();
    this.unlistenFinished?.();
    this.unlistenOutput = null;
    this.unlistenFinished = null;
  }
}
