import type { ComponentType } from 'react';
import { memo } from 'react';
import { ChevronRight, FileJson, FolderInput, Import } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import { GoodnotesIcon } from './brand-icons';

interface ImportPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportFiles?: () => void;
  onImportGoodnotesZip?: () => void;
  onImportObsidianVault?: () => void;
  onImportWorkspaceJson?: () => void;
}

export const ImportPickerDialog = memo(function ImportPickerDialog({
  open,
  onOpenChange,
  onImportFiles,
  onImportGoodnotesZip,
  onImportObsidianVault,
  onImportWorkspaceJson,
}: ImportPickerDialogProps) {
  const strings = useMessages().library.importPicker;

  const options: {
    key: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    description: string;
    onSelect?: () => void;
  }[] = [
    {
      key: 'files',
      icon: Import,
      label: strings.files.label,
      description: strings.files.description,
      onSelect: onImportFiles,
    },
    {
      key: 'goodnotes',
      icon: GoodnotesIcon,
      label: strings.goodnotesZip.label,
      description: strings.goodnotesZip.description,
      onSelect: onImportGoodnotesZip,
    },
    {
      key: 'obsidian',
      icon: FolderInput,
      label: strings.obsidianVault.label,
      description: strings.obsidianVault.description,
      onSelect: onImportObsidianVault,
    },
    {
      key: 'workspace-json',
      icon: FileJson,
      label: strings.workspaceJson.label,
      description: strings.workspaceJson.description,
      onSelect: onImportWorkspaceJson,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{strings.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {options.map(({ key, icon: Icon, label, description, onSelect }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSelect?.();
              }}
              className="group flex w-full items-center gap-3.5 rounded-xl bg-input/40 px-4 py-3 text-left ring-1 ring-border-subtle/70 transition-colors duration-200 hover:bg-input"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover-tint text-text-secondary transition-colors duration-200 group-hover:text-text-primary">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm text-text-primary">
                  {label}
                </span>
                <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
                  {description}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
