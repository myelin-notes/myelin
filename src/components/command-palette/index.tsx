import { CommandPaletteDialog } from './dialog';
import { useCommandPalette } from './use-command-palette';

export function CommandPalette() {
  const { dialogProps } = useCommandPalette();

  return <CommandPaletteDialog {...dialogProps} />;
}
