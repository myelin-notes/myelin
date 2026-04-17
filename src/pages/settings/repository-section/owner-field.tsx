import {
  Building2,
  ChevronDown,
  Loader2,
  Lock,
  User as UserIcon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GitHubOrg, GitHubUser } from '@/lib/sync';
import { cn } from '@/lib/utils';
import { Avatar, FIELD_TRIGGER_CLASS } from './dropdown-field';

export function OwnerField({
  disabled,
  loading,
  user,
  orgs,
  value,
  onChange,
  className,
}: {
  disabled: boolean;
  loading: boolean;
  user: GitHubUser | null;
  orgs: GitHubOrg[];
  value: string;
  onChange: (owner: string) => void;
  className?: string;
}) {
  const selectedIsUser = Boolean(user) && value === user?.login;
  const selectedOrg = orgs.find((org) => org.login === value);
  const hasOrgs = orgs.length > 0;
  const displayLogin = value || user?.login || '';

  const selectedIcon = selectedIsUser ? (
    <Avatar src={user?.avatarUrl} fallback={<UserIcon className="size-3" />} />
  ) : selectedOrg ? (
    <Avatar
      src={selectedOrg.avatarUrl}
      fallback={<Building2 className="size-3" />}
    />
  ) : user ? (
    <Avatar src={user.avatarUrl} fallback={<UserIcon className="size-3" />} />
  ) : (
    <Avatar src={null} fallback={<UserIcon className="size-3" />} />
  );

  if (!hasOrgs) {
    return (
      <div
        className={cn(
          FIELD_TRIGGER_CLASS,
          'pointer-events-none cursor-default',
          (disabled || !user) && 'opacity-60',
          className,
        )}
        aria-disabled="true"
      >
        {loading ? (
          <>
            <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" />
            <span className="text-text-muted">Loading account…</span>
          </>
        ) : (
          <>
            {selectedIcon}
            <span className="truncate">{displayLogin || '—'}</span>
            <Lock className="ml-auto size-3 shrink-0 text-text-muted" />
          </>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || loading || !user}
        className={cn(FIELD_TRIGGER_CLASS, className)}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" />
            <span className="text-text-muted">Loading account…</span>
          </>
        ) : (
          <>
            {selectedIcon}
            <span className="truncate">{displayLogin || 'Select owner'}</span>
          </>
        )}
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {user && (
            <DropdownMenuRadioItem value={user.login}>
              <Avatar
                src={user.avatarUrl}
                fallback={<UserIcon className="size-3" />}
              />
              <span className="truncate">{user.login}</span>
              <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-widest">
                You
              </span>
            </DropdownMenuRadioItem>
          )}
          {orgs.map((org) => (
            <DropdownMenuRadioItem key={org.login} value={org.login}>
              <Avatar
                src={org.avatarUrl}
                fallback={<Building2 className="size-3" />}
              />
              <span className="truncate">{org.login}</span>
              <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-widest">
                Org
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
