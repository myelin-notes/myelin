import {
  createDefaultPdfPageOrder,
  normalizePdfPageOrder,
  normalizePdfPageSizes,
  type PdfPageOrderEntry,
  type PdfPageSize,
} from '../../pdf-renderer';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type PageLayout,
} from '../page-frame-constants';
import { buildPdfLayout, type PdfLayout } from './layout';

export const DEFAULT_PDF_PAGE_SIZE: PdfPageSize = {
  w: PAGE_WIDTH,
  h: PAGE_HEIGHT,
};

export interface PdfDocumentMetadata {
  pageSizes: PdfPageSize[];
  pageOrder: PdfPageOrderEntry[];
  pageOrderCustom: boolean;
}

export class PdfDocumentModel {
  private _bytes: Uint8Array | null = null;
  private _fileName = '';
  private _pageSizes: PdfPageSize[] = [DEFAULT_PDF_PAGE_SIZE];
  private _pageOrder: PdfPageOrderEntry[] = createDefaultPdfPageOrder(1);
  private _pageOrderCustom = false;
  private _pageLayout: PageLayout;
  private _layout: PdfLayout | null = null;

  public constructor(pageLayout: PageLayout = 'vertical') {
    this._pageLayout = pageLayout === 'horizontal' ? 'horizontal' : 'vertical';
  }

  public get bytes(): Uint8Array | null {
    return this._bytes;
  }

  public get fileName(): string {
    return this._fileName;
  }

  public get pageLayout(): PageLayout {
    return this._pageLayout;
  }

  public get layout(): PdfLayout {
    this._layout ??= buildPdfLayout({
      pageSizes: this._pageSizes,
      pageOrder: this.pageEntries,
      pageLayout: this._pageLayout,
      defaultPageSize: DEFAULT_PDF_PAGE_SIZE,
    });
    return this._layout;
  }

  public get pageEntries(): PdfPageOrderEntry[] {
    return clonePageOrder(
      normalizePdfPageOrder(
        this._pageOrder,
        this._pageSizes.length,
        DEFAULT_PDF_PAGE_SIZE,
        this._pageOrderCustom,
      ),
    );
  }

  public get metadata(): PdfDocumentMetadata {
    return {
      pageSizes: clonePageSizes(this._pageSizes),
      pageOrder: this.pageEntries,
      pageOrderCustom: this._pageOrderCustom,
    };
  }

  public getYMapProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      fileName: this._fileName,
      pageSizes: clonePageSizes(this._pageSizes),
      pageOrder: this.pageEntries,
      pageLayout: this._pageLayout,
    };
    if (this._pageOrderCustom) {
      props.pageOrderCustom = true;
    }
    if (this._bytes) {
      props.pdfData = cloneBytes(this._bytes);
    }
    return props;
  }

  public setBytes(bytes: Uint8Array): void {
    this._bytes = cloneBytes(bytes);
  }

  public setFileName(fileName: string): void {
    this._fileName = fileName;
  }

  public setPageLayout(pageLayout: PageLayout): boolean {
    const next = pageLayout === 'horizontal' ? 'horizontal' : 'vertical';
    if (next === this._pageLayout) {
      return false;
    }
    this._pageLayout = next;
    this._layout = null;
    return true;
  }

  public setPageSizes(pageSizes: PdfPageSize[]): void {
    const nextPageSizes =
      pageSizes.length > 0
        ? clonePageSizes(pageSizes)
        : [DEFAULT_PDF_PAGE_SIZE];
    this._pageSizes = nextPageSizes;
    this._pageOrder = normalizePdfPageOrder(
      this._pageOrder,
      nextPageSizes.length,
      DEFAULT_PDF_PAGE_SIZE,
      this._pageOrderCustom,
    );
    this._layout = null;
  }

  public setPageOrder(value: unknown, allowMissingPdfPages: boolean): void {
    if (allowMissingPdfPages) {
      this._pageOrderCustom = true;
    }
    this._pageOrder = normalizePdfPageOrder(
      value,
      this._pageSizes.length,
      DEFAULT_PDF_PAGE_SIZE,
      allowMissingPdfPages,
    );
    this._layout = null;
  }

  public setPageOrderCustom(value: boolean): void {
    this._pageOrderCustom = value;
  }

  public insertBlankPage(position: number): boolean {
    const layout = this.layout;
    if (layout.pages.length < 1) {
      return false;
    }
    const insertPosition = Math.max(
      0,
      Math.min(Math.floor(position), layout.pages.length),
    );
    const reference =
      layout.pages[Math.max(0, insertPosition - 1)] ?? layout.pages[0];
    const nextOrder = this.pageEntries;
    nextOrder.splice(insertPosition, 0, {
      kind: 'blank',
      size: { ...reference.size },
    });
    this.setCustomPageOrder(nextOrder);
    return true;
  }

  public deletePage(position: number): boolean {
    const layout = this.layout;
    if (layout.pages.length <= 1) {
      return false;
    }
    const pagePosition = Math.max(
      0,
      Math.min(Math.floor(position), layout.pages.length - 1),
    );
    const nextOrder = this.pageEntries;
    nextOrder.splice(pagePosition, 1);
    this.setCustomPageOrder(nextOrder);
    return true;
  }

  public shouldLoadPageMetadata(params: {
    hasPageSizes: boolean;
    hasPageOrder: boolean;
    pageCount: number;
  }): boolean {
    if (!params.hasPageSizes || !params.hasPageOrder) {
      return true;
    }
    if (this._pageSizes.length !== params.pageCount) {
      return true;
    }
    const normalizedOrder = normalizePdfPageOrder(
      this._pageOrder,
      params.pageCount,
      DEFAULT_PDF_PAGE_SIZE,
      this._pageOrderCustom,
    );
    return (
      !arePageOrdersEqual(this._pageOrder, normalizedOrder) ||
      (params.pageCount === 1 &&
        this._pageSizes.length === 1 &&
        isDefaultPageSize(this._pageSizes[0]))
    );
  }

  public differsFromStoredMetadata(params: {
    hasPageSizes: boolean;
    hasPageOrder: boolean;
    pageSizes: unknown;
    pageOrder: unknown;
    pageOrderCustom: unknown;
  }): boolean {
    if (!params.hasPageSizes || !params.hasPageOrder) {
      return true;
    }
    return (
      !arePageSizesEqual(
        normalizePdfPageSizes(params.pageSizes),
        this._pageSizes,
      ) ||
      !arePageOrdersEqual(
        normalizePdfPageOrder(
          params.pageOrder,
          this._pageSizes.length,
          DEFAULT_PDF_PAGE_SIZE,
          params.pageOrderCustom === true,
        ),
        this.pageEntries,
      )
    );
  }

  private setCustomPageOrder(pageOrder: PdfPageOrderEntry[]): void {
    this._pageOrderCustom = true;
    this._pageOrder = clonePageOrder(pageOrder);
    this._layout = null;
  }
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export function clonePageSizes(
  pageSizes: readonly PdfPageSize[],
): PdfPageSize[] {
  return pageSizes.map((size) => ({ w: size.w, h: size.h }));
}

export function clonePageOrder(
  pageOrder: readonly PdfPageOrderEntry[],
): PdfPageOrderEntry[] {
  return pageOrder.map((entry) =>
    entry.kind === 'pdf'
      ? { kind: 'pdf', originalIndex: entry.originalIndex }
      : { kind: 'blank', size: { ...entry.size } },
  );
}

function arePageSizesEqual(
  left: readonly PdfPageSize[],
  right: readonly PdfPageSize[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (size, index) => size.w === right[index].w && size.h === right[index].h,
    )
  );
}

function arePageOrdersEqual(
  left: readonly PdfPageOrderEntry[],
  right: readonly PdfPageOrderEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      if (entry.kind !== other.kind) {
        return false;
      }
      if (entry.kind === 'pdf' && other.kind === 'pdf') {
        return entry.originalIndex === other.originalIndex;
      }
      return (
        entry.kind === 'blank' &&
        other.kind === 'blank' &&
        entry.size.w === other.size.w &&
        entry.size.h === other.size.h
      );
    })
  );
}

function isDefaultPageSize(size: PdfPageSize): boolean {
  return (
    size.w === DEFAULT_PDF_PAGE_SIZE.w && size.h === DEFAULT_PDF_PAGE_SIZE.h
  );
}
