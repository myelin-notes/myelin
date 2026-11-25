import { useRef, useState } from 'react';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  NAME_PATTERN_TOKENS,
  renderNamePattern,
} from '@/lib/note/name-pattern';
import { useTemplates } from '@/lib/note/use-templates';
import {
  type FolderNameRule,
  useRepository,
  type VFSFolderNode,
} from '@/lib/sync';

const logger = new Logger('FolderSettings');

type RuleMode = 'none' | FolderNameRule['mode'];
const RULE_MODES: RuleMode[] = ['none', 'custom', 'inherit'];

interface FolderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: VFSFolderNode;
  onChanged: () => void | Promise<void>;
}

export function FolderSettingsDialog({
  open,
  onOpenChange,
  folder,
  onChanged,
}: FolderSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <FolderSettingsContent
          folder={folder}
          onChanged={onChanged}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function FolderSettingsContent({
  folder,
  onChanged,
  onClose,
}: Pick<FolderSettingsDialogProps, 'folder' | 'onChanged'> & {
  onClose: () => void;
}) {
  const repository = useRepository();
  const locale = useLocale();
  const strings = useMessages().library.folderSettings;
  const { templates } = useTemplates();
  const [templateId, setTemplateId] = useState(folder.defaultTemplateId ?? '');
  const [mode, setMode] = useState<RuleMode>(folder.nameRule?.mode ?? 'none');
  const [pattern, setPattern] = useState(
    folder.nameRule?.mode === 'custom' ? folder.nameRule.pattern : '',
  );
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = mode !== 'custom' || pattern.trim() !== '';

  const insertToken = (token: string) => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.setRangeText(
      token,
      input.selectionStart ?? input.value.length,
      input.selectionEnd ?? input.value.length,
      'end',
    );
    setPattern(input.value);
  };

  const save = async () => {
    setError(false);
    try {
      await repository.setFolderDefaultTemplate(folder.id, templateId || null);
      await repository.setFolderNameRule(
        folder.id,
        mode === 'custom'
          ? { mode, pattern }
          : mode === 'inherit'
            ? { mode }
            : null,
      );
      await onChanged();
      onClose();
    } catch (err) {
      logger.error('Failed to save folder settings', err, {
        folderId: folder.id,
      });
      setError(true);
    }
  };

  const ruleLabels: Record<RuleMode, string> = {
    none: strings.ruleNone,
    custom: strings.ruleCustom,
    inherit: strings.ruleInherit,
  };

  return (
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{strings.title}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="folder-default-template"
          className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]"
        >
          {strings.defaultTemplate}
        </label>
        <select
          id="folder-default-template"
          value={templates.some((t) => t.id === templateId) ? templateId : ''}
          onChange={(e) => setTemplateId(e.target.value)}
          className="h-8 w-full rounded-sm border-transparent border-b-2 bg-input px-2 text-sm outline-none focus-visible:border-primary"
        >
          <option value="">{strings.noTemplate}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <p className="text-text-muted text-xs">{strings.defaultTemplateHint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <span
          id="folder-name-rule"
          className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]"
        >
          {strings.nameRule}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="folder-name-rule"
          className="flex rounded-lg bg-surface p-0.5"
        >
          {RULE_MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                'min-h-8 flex-1 cursor-pointer rounded-md px-2 text-xs transition-colors',
                mode === option
                  ? 'bg-page font-medium text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {ruleLabels[option]}
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <>
            <Input
              ref={inputRef}
              aria-label={strings.pattern}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="{date} - "
            />
            <div
              role="group"
              aria-label={strings.insertToken}
              className="flex flex-wrap gap-1.5"
            >
              {NAME_PATTERN_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="cursor-pointer rounded-md bg-surface px-2 py-1 font-mono text-text-secondary text-xs hover:text-text-primary"
                >
                  {token}
                </button>
              ))}
            </div>
            <p className="truncate text-text-muted text-xs">
              {strings.preview}:{' '}
              <span className="whitespace-pre text-text-primary">
                {renderNamePattern(pattern, new Date(), locale)}
              </span>
            </p>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {strings.saveFailed}
        </p>
      )}
      <Button disabled={!valid} onClick={() => void save()}>
        {strings.save}
      </Button>
    </DialogContent>
  );
}
