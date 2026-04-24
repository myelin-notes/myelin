import { MARKDOWN_FILE_ACCEPT } from '@/pages/library/import-markdown';
import { CommandPaletteDialog } from './dialog';
import { useCommandPalette } from './use-command-palette';

export function CommandPalette() {
  const { dialogProps, markdownInputRef, handleMarkdownInputChange } =
    useCommandPalette();

  return (
    <>
      <input
        ref={markdownInputRef}
        type="file"
        accept={MARKDOWN_FILE_ACCEPT}
        className="hidden"
        onChange={handleMarkdownInputChange}
      />
      <CommandPaletteDialog {...dialogProps} />
    </>
  );
}
