import { toast } from 'sonner';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@myelin/ui';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  renderTemplateFields,
  TEMPLATE_FIELD_TOKENS,
} from '@/lib/note/name-pattern';

function isEditable(element: Element | null): boolean {
  return (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement)
  );
}

async function insertField(token: string, copiedMessage: string) {
  // execCommand is deprecated but the one editor-agnostic way to type into whichever text box or
  // page frame (ProseMirror reads the DOM change back) has focus.
  if (
    isEditable(document.activeElement) &&
    document.execCommand('insertText', false, token)
  ) {
    return;
  }
  await writeText(token);
  toast.success(copiedMessage);
}

export function TemplateFieldsBar({ name }: { name: string }) {
  const strings = useMessages().library.templates;
  const locale = useLocale();
  return (
    <div
      role="toolbar"
      aria-label={strings.fieldsLabel}
      className="absolute top-6 left-1/2 z-[100] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-xl bg-card px-3 py-2 ring-1 ring-border-subtle/70"
    >
      <span className="shrink-0 font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
        {strings.fieldsLabel}
      </span>
      <TooltipProvider>
        {TEMPLATE_FIELD_TOKENS.map((token) => (
          <Tooltip key={token}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  // Keep focus (and the caret) in the text being edited.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() =>
                    void insertField(token, strings.fieldCopied(token))
                  }
                  className="shrink-0 cursor-pointer rounded-md bg-surface px-2 py-1 font-mono text-text-secondary text-xs hover:text-text-primary"
                />
              }
            >
              {token}
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex max-w-60 flex-col gap-1">
                <span className="font-medium">
                  {renderTemplateFields(token, name, new Date(), locale)}
                </span>
                <span className="opacity-80">{strings.fieldHint}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </div>
  );
}
