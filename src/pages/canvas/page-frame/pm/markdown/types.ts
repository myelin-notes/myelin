export const MARKDOWN_ATOM_CHAR = '\uFFFC';

export type BlockPrefixMatch = 'h1' | 'h2' | 'h3' | 'blockquote';

export type InlinePreviewKind =
  | 'bold'
  | 'italic'
  | 'inlineCode'
  | 'noteLink'
  | 'math';

export interface DelimiterRange {
  from: number;
  to: number;
}

export interface InlinePreviewRange {
  kind: InlinePreviewKind;
  contentFrom: number;
  contentTo: number;
  open: DelimiterRange;
  close: DelimiterRange;
}

export interface ParsedInlineMarkdown {
  ranges: InlinePreviewRange[];
}

export type FenceLineKind = 'openingFence' | 'closingFence' | 'content';

export interface FenceLine {
  kind: FenceLineKind;
  text: string;
  from: number;
  to: number;
  fullFrom: number;
  fullTo: number;
}

export interface ParsedFenceMarkdown {
  hasOpeningFence: boolean;
  hasClosingFence: boolean;
  lines: FenceLine[];
  closingFence: FenceLine | null;
}
