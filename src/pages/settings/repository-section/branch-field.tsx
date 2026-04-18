import { ChevronDown, GitBranch, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStrings } from '@/lib/i18n';
import type { GitHubBranch } from '@/lib/sync';
import { cn } from '@/lib/utils';
import {
  FIELD_TRIGGER_CLASS,
  MenuEmptyRow,
  MenuLoadingRow,
} from './dropdown-field';

export function BranchField({
  disabled,
  loading,
  branches,
  value,
  onChange,
  className,
}: {
  disabled: boolean;
  loading: boolean;
  branches: GitHubBranch[];
  value: string;
  onChange: (branch: string) => void;
  className?: string;
}) {
  const strings = useStrings();
  const selected = branches.find((b) => b.name === value);
  const hasBranches = branches.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(FIELD_TRIGGER_CLASS, className)}
      >
        <GitBranch className="size-4 shrink-0 text-text-muted" />
        {value ? (
          <>
            <span className="truncate">{value}</span>
            {selected?.protected && (
              <Lock className="size-3 shrink-0 text-text-muted" />
            )}
          </>
        ) : (
          <span className="truncate text-text-muted">
            {disabled
              ? strings.settings.repository.fields.branch.pickRepo
              : strings.settings.repository.fields.branch.select}
          </span>
        )}
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-48">
        {loading && !hasBranches ? (
          <MenuLoadingRow
            label={strings.settings.repository.fields.branch.loading}
          />
        ) : !hasBranches ? (
          <MenuEmptyRow
            label={strings.settings.repository.fields.branch.empty}
          />
        ) : (
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {branches.map((branch) => (
              <DropdownMenuRadioItem key={branch.name} value={branch.name}>
                <GitBranch className="size-3.5 shrink-0 text-text-muted" />
                <span className="truncate">{branch.name}</span>
                {branch.protected && (
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
