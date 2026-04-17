import { ChevronDown, GitBranch, Loader2, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GitHubBranch } from '@/lib/sync';
import { FIELD_TRIGGER_CLASS, FieldLabel } from './dropdown-field';

export function BranchField({
  disabled,
  loading,
  branches,
  value,
  onChange,
}: {
  disabled: boolean;
  loading: boolean;
  branches: GitHubBranch[];
  value: string;
  onChange: (branch: string) => void;
}) {
  const hasBranches = branches.length > 0;
  const selected = branches.find((b) => b.name === value);
  const triggerDisabled = disabled || loading || !hasBranches;

  return (
    <div>
      <FieldLabel>Branch</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={triggerDisabled}
          className={FIELD_TRIGGER_CLASS}
        >
          {loading ? (
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" />
              <span className="text-text-muted">Loading branches…</span>
            </>
          ) : value ? (
            <>
              <GitBranch className="size-4 shrink-0 text-text-muted" />
              <span className="truncate">{value}</span>
              {selected?.protected && (
                <Lock className="size-3 shrink-0 text-text-muted" />
              )}
            </>
          ) : (
            <>
              <GitBranch className="size-4 shrink-0 text-text-muted" />
              <span className="text-text-muted">
                {disabled
                  ? 'Select a repository first'
                  : hasBranches
                    ? 'Select a branch'
                    : 'No branches available'}
              </span>
            </>
          )}
          <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80">
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
