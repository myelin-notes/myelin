import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IMPORT_PROVIDERS, type ImportProviderId } from './providers';

interface ImportPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: ImportProviderId) => void;
}

export const ImportPickerDialog = memo(function ImportPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: ImportPickerDialogProps) {
  const strings = useMessages().library;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{strings.importPicker.title}</DialogTitle>
          <DialogDescription>
            {strings.importPicker.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {IMPORT_PROVIDERS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSelect(id);
              }}
              className="group flex w-full items-center gap-3.5 rounded-xl bg-input/40 px-4 py-3 text-left ring-1 ring-border-subtle/70 transition-colors duration-200 hover:bg-input"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover-tint text-text-secondary transition-colors duration-200 group-hover:text-text-primary">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm text-text-primary">
                  {strings.importSources[id].label}
                </span>
                <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
                  {strings.importSources[id].description}
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
