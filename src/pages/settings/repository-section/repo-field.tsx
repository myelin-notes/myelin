import { Book, ChevronDown, Loader2, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GitHubRepo } from '@/lib/sync';
import { FIELD_TRIGGER_CLASS, FieldLabel } from './dropdown-field';

export function RepoField({
  disabled,
  loading,
  repos,
  value,
  onChange,
}: {
  disabled: boolean;
  loading: boolean;
  repos: GitHubRepo[];
  value: string;
  onChange: (repo: string) => void;
}) {
  const selected = repos.find((r) => r.name === value);
  const hasRepos = repos.length > 0;
  const triggerDisabled = disabled || loading || !hasRepos;

  return (
    <div>
      <FieldLabel>Repository</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={triggerDisabled}
          className={FIELD_TRIGGER_CLASS}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" />
              <span className="text-text-muted">Loading repositories…</span>
            </>
          ) : value ? (
            <>
              <Book className="size-4 shrink-0 text-text-muted" />
              <span className="truncate">{value}</span>
              {selected?.private && (
                <Lock className="size-3 shrink-0 text-text-muted" />
              )}
            </>
          ) : (
            <>
              <Book className="size-4 shrink-0 text-text-muted" />
              <span className="text-text-muted">
                {disabled
                  ? 'Select an owner first'
                  : hasRepos
                    ? 'Select a repository'
                    : 'No repositories available'}
              </span>
            </>
          )}
          <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {repos.map((repo) => (
              <DropdownMenuRadioItem key={repo.name} value={repo.name}>
                <Book className="size-3.5 shrink-0 text-text-muted" />
                <span className="truncate">{repo.name}</span>
                {repo.private && (
                  <Lock className="ml-auto size-3 shrink-0 text-text-muted" />
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
