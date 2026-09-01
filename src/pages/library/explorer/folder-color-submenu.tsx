import { Palette } from 'lucide-react';
import { AddColorSwatch } from '@myelin/editor/components/add-color-swatch';
import { ColorSwatch } from '@myelin/editor/components/color-swatch';
import { CustomColorSwatch } from '@myelin/editor/components/custom-color-swatch';
import { useCustomColors } from '@myelin/editor/custom-colors';
import { useMessages } from '@myelin/editor/i18n';
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@myelin/ui/context-menu';
import { DEFAULT_FOLDER_COLOR, FOLDER_COLORS } from './folder-colors';

interface FolderColorSubmenuProps {
  color: string | undefined;
  onSelect: (color: string) => void;
  onAddCustom: () => void;
}

export function FolderColorSubmenu({
  color,
  onSelect,
  onAddCustom,
}: FolderColorSubmenuProps) {
  const strings = useMessages();
  const {
    colors: customColors,
    canAddColor,
    removeColor,
  } = useCustomColors('folder');
  const current = color ?? DEFAULT_FOLDER_COLOR;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary data-open:bg-surface data-open:text-text-primary">
        <Palette className="size-4" />
        {strings.library.itemMenu.color}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="rounded-xl bg-page p-2.5 shadow-ambient">
        <div className="flex max-w-[124px] flex-wrap items-center gap-1.5">
          {FOLDER_COLORS.map((swatch) => (
            <ColorSwatch
              key={swatch}
              color={swatch}
              active={current === swatch}
              onClick={() => onSelect(swatch)}
            />
          ))}
          {customColors.map((swatch) => (
            <CustomColorSwatch
              key={swatch}
              color={swatch}
              active={current === swatch}
              onClick={() => onSelect(swatch)}
              onDelete={() => void removeColor(swatch)}
            />
          ))}
          {canAddColor && <AddColorSwatch onClick={onAddCustom} />}
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
