import { Book, ChevronDown, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStrings } from '@/lib/i18n';
import type { GitHubRepo } from '@/lib/sync';
import { cn } from '@/lib/utils';
import {
  FIELD_TRIGGER_CLASS,
  MenuEmptyRow,
  MenuLoadingRow,
} from './dropdown-field';

export function RepoField({
  disabled,
  loading,
  repos,
  value,
  onChange,
  className,
}: {
  disabled: boolean;
  loading: boolean;
  repos: GitHubRepo[];
  value: string;
  onChange: (repo: string) => void;
  className?: string;
}) {
  const strings = useStrings();
  const selected = repos.find((r) => r.name === value);
  const hasRepos = repos.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(FIELD_TRIGGER_CLASS, className)}
      >
        <Book className="size-4 shrink-0 text-text-muted" />
        {value ? (
          <>
            <span className="truncate">{value}</span>
            {selected?.private && (
              <Lock className="size-3 shrink-0 text-text-muted" />
            )}
          </>
        ) : (
          <span className="truncate text-text-muted">
            {disabled
              ? strings.settings.repository.fields.repo.pickOwner
              : strings.settings.repository.fields.repo.select}
          </span>
        )}
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56">
        {loading && !hasRepos ? (
          <MenuLoadingRow
            label={strings.settings.repository.fields.repo.loading}
          />
        ) : !hasRepos ? (
          <MenuEmptyRow label={strings.settings.repository.fields.repo.empty} />
        ) : (
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
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
