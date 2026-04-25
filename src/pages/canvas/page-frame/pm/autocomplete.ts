import type { EditorView } from 'prosemirror-view';

export interface PageFrameAutocompleteItem {
  id: string;
  title: string;
  subtitle?: string;
  detail?: string;
}

export interface PageFrameAutocompleteRange {
  from: number;
  to: number;
}

export interface PageFrameAutocompleteRequest {
  query: string;
  range: PageFrameAutocompleteRange;
  anchorPosition?: number;
  limit?: number;
}

export interface PageFrameAutocompleteSourceRequest
  extends PageFrameAutocompleteRequest {
  signal: AbortSignal;
}

export type PageFrameAutocompleteSource = (
  request: PageFrameAutocompleteSourceRequest,
) =>
  | readonly PageFrameAutocompleteItem[]
  | Promise<readonly PageFrameAutocompleteItem[]>;

export type PageFrameAutocompleteStatus =
  | 'closed'
  | 'loading'
  | 'open'
  | 'empty'
  | 'error';

export interface PageFrameAutocompleteState {
  open: boolean;
  query: string;
  range: PageFrameAutocompleteRange | null;
  anchorPosition: number | null;
  items: readonly PageFrameAutocompleteItem[];
  activeIndex: number;
  status: PageFrameAutocompleteStatus;
  error: Error | null;
}

export type PageFrameAutocompleteKeyResult =
  | { handled: false }
  | { handled: true; action: 'close' | 'navigate' }
  | {
      handled: true;
      action: 'select';
      item: PageFrameAutocompleteItem;
    };

export interface PageFrameAutocompleteControllerOptions {
  source: PageFrameAutocompleteSource;
  limit?: number;
}

export interface PageFrameAutocompleteAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'preventDefault'>;
type PageFrameAutocompleteListener = () => void;

const DEFAULT_LIMIT = 8;

function createClosedState(): PageFrameAutocompleteState {
  return {
    open: false,
    query: '',
    range: null,
    anchorPosition: null,
    items: [],
    activeIndex: -1,
    status: 'closed',
    error: null,
  };
}

function normalizeRange(
  range: PageFrameAutocompleteRange,
): PageFrameAutocompleteRange {
  if (range.from <= range.to) {
    return range;
  }
  return { from: range.to, to: range.from };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function scalePageFrameAutocompleteAnchorRect(
  rect: Pick<
    PageFrameAutocompleteAnchorRect,
    'left' | 'right' | 'top' | 'bottom'
  >,
  devicePixelRatio: number,
): PageFrameAutocompleteAnchorRect {
  const left = rect.left * devicePixelRatio;
  const right = rect.right * devicePixelRatio;
  const top = rect.top * devicePixelRatio;
  const bottom = rect.bottom * devicePixelRatio;
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function getPageFrameAutocompleteAnchorRect(
  view: EditorView,
  position: number,
  devicePixelRatio: number = window.devicePixelRatio || 1,
): PageFrameAutocompleteAnchorRect | null {
  try {
    return scalePageFrameAutocompleteAnchorRect(
      view.coordsAtPos(position),
      devicePixelRatio,
    );
  } catch {
    return null;
  }
}

export class PageFrameAutocompleteController {
  private state: PageFrameAutocompleteState = createClosedState();
  private readonly listeners = new Set<PageFrameAutocompleteListener>();
  private readonly source: PageFrameAutocompleteSource;
  private readonly limit: number;
  private requestId = 0;
  private abortController: AbortController | null = null;

  constructor(options: PageFrameAutocompleteControllerOptions) {
    this.source = options.source;
    this.limit = options.limit ?? DEFAULT_LIMIT;
  }

  public getState(): PageFrameAutocompleteState {
    return this.state;
  }

  public subscribe(listener: PageFrameAutocompleteListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public show(request: PageFrameAutocompleteRequest): void {
    const range = normalizeRange(request.range);
    const anchorPosition = request.anchorPosition ?? range.to;
    const limit = request.limit ?? this.limit;

    this.setState({
      open: true,
      query: request.query,
      range,
      anchorPosition,
      items: [],
      activeIndex: -1,
      status: 'loading',
      error: null,
    });

    void this.loadItems({
      ...request,
      range,
      anchorPosition,
      limit,
    });
  }

  public close(): void {
    this.abortPendingRequest();
    this.setState(createClosedState());
  }

  public dispose(): void {
    this.abortPendingRequest();
    this.listeners.clear();
  }

  public moveActive(delta: number): void {
    if (!this.state.open || this.state.items.length === 0) {
      return;
    }

    const lastIndex = this.state.items.length - 1;
    const current =
      this.state.activeIndex >= 0 ? this.state.activeIndex : delta > 0 ? -1 : 0;
    const next =
      (current + delta + this.state.items.length) % this.state.items.length;

    this.setState({
      ...this.state,
      activeIndex: clamp(next, 0, lastIndex),
    });
  }

  public setActiveIndex(index: number): void {
    if (!this.state.open || this.state.items.length === 0) {
      return;
    }

    this.setState({
      ...this.state,
      activeIndex: clamp(index, 0, this.state.items.length - 1),
    });
  }

  public getActiveItem(): PageFrameAutocompleteItem | null {
    if (this.state.activeIndex < 0) {
      return null;
    }
    return this.state.items[this.state.activeIndex] ?? null;
  }

  public select(
    index: number = this.state.activeIndex,
  ): PageFrameAutocompleteItem | null {
    if (!this.state.open || index < 0) {
      return null;
    }

    const item = this.state.items[index];
    if (!item) {
      return null;
    }

    this.close();
    return item;
  }

  public handleKeyDown(event: KeyEventLike): PageFrameAutocompleteKeyResult {
    if (!this.state.open) {
      return { handled: false };
    }

    const hasItems = this.state.items.length > 0;

    switch (event.key) {
      case 'ArrowDown':
        if (!hasItems) {
          return { handled: false };
        }
        event.preventDefault();
        this.moveActive(1);
        return { handled: true, action: 'navigate' };
      case 'ArrowUp':
        if (!hasItems) {
          return { handled: false };
        }
        event.preventDefault();
        this.moveActive(-1);
        return { handled: true, action: 'navigate' };
      case 'Home':
        if (!hasItems) {
          return { handled: false };
        }
        event.preventDefault();
        this.setActiveIndex(0);
        return { handled: true, action: 'navigate' };
      case 'End':
        if (!hasItems) {
          return { handled: false };
        }
        event.preventDefault();
        this.setActiveIndex(this.state.items.length - 1);
        return { handled: true, action: 'navigate' };
      case 'Enter':
      case 'Tab': {
        const item = this.getActiveItem();
        if (!item) {
          return { handled: false };
        }
        event.preventDefault();
        this.close();
        return { handled: true, action: 'select', item };
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        return { handled: true, action: 'close' };
      default:
        return { handled: false };
    }
  }

  private async loadItems(
    request: PageFrameAutocompleteRequest & {
      anchorPosition: number;
      limit: number;
    },
  ): Promise<void> {
    this.abortPendingRequest();
    const abortController = new AbortController();
    this.abortController = abortController;
    const requestId = ++this.requestId;

    try {
      const items = await this.source({
        ...request,
        signal: abortController.signal,
      });

      if (
        abortController.signal.aborted ||
        requestId !== this.requestId ||
        !this.state.open
      ) {
        return;
      }

      const limitedItems = items.slice(0, request.limit);
      this.setState({
        ...this.state,
        items: limitedItems,
        activeIndex: limitedItems.length > 0 ? 0 : -1,
        status: limitedItems.length > 0 ? 'open' : 'empty',
        error: null,
      });
    } catch (error) {
      if (abortController.signal.aborted || requestId !== this.requestId) {
        return;
      }

      this.setState({
        ...this.state,
        items: [],
        activeIndex: -1,
        status: 'error',
        error: toError(error),
      });
    }
  }

  private abortPendingRequest(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private setState(nextState: PageFrameAutocompleteState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
