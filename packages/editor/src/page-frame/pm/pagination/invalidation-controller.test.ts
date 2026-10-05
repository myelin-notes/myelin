import type { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePaginationInvalidations } from './invalidation-controller';

class FakeHTMLElement extends EventTarget {
  public readonly style = { setProperty: vi.fn() };
}

class FakeResizeObserver {
  public static latest: FakeResizeObserver | null = null;
  public readonly disconnect = vi.fn();
  public readonly observe = vi.fn();

  public constructor(private readonly callback: () => void) {
    FakeResizeObserver.latest = this;
  }

  public notify(): void {
    this.callback();
  }
}

class FakeMutationObserver {
  public static latest: FakeMutationObserver | null = null;
  public readonly disconnect = vi.fn();
  public readonly observe = vi.fn();

  public constructor(private readonly callback: () => void) {
    FakeMutationObserver.latest = this;
  }

  public notify(): void {
    this.callback();
  }
}

afterEach(() => {
  FakeMutationObserver.latest = null;
  FakeResizeObserver.latest = null;
  vi.unstubAllGlobals();
});

describe('observePaginationInvalidations', () => {
  it('schedules pagination for browser layout changes and disconnects cleanly', async () => {
    const fonts = Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
    });
    const layoutHost = new FakeHTMLElement();
    const editorDom = Object.assign(new EventTarget(), {
      closest: () => layoutHost,
    });
    const schedule = vi.fn();

    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('MutationObserver', FakeMutationObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('document', { fonts });

    const stop = observePaginationInvalidations(
      { dom: editorDom } as unknown as EditorView,
      schedule,
      () => false,
      4,
    );
    await Promise.resolve();

    expect(layoutHost.style.setProperty).toHaveBeenCalledWith(
      '--pm-content-height',
      '784px',
    );
    FakeResizeObserver.latest?.notify();
    FakeMutationObserver.latest?.notify();
    fonts.dispatchEvent(new Event('loadingdone'));
    editorDom.dispatchEvent(new Event('focusin'));

    expect(schedule).toHaveBeenCalledTimes(5);
    expect(schedule).toHaveBeenLastCalledWith(4);

    stop();

    expect(FakeResizeObserver.latest?.disconnect).toHaveBeenCalledOnce();
    expect(FakeMutationObserver.latest?.disconnect).toHaveBeenCalledOnce();
  });
});
