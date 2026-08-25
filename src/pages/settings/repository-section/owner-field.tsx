import { Building2, ChevronDown, Lock, User as UserIcon } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GitHubOrg, GitHubUser } from '@/lib/sync';
import { Avatar, FIELD_TRIGGER_CLASS, MenuLoadingRow } from './dropdown-field';

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
  const strings = useMessages();
  const selectedIsUser = Boolean(user) && value === user?.login;
  const selectedOrg = orgs.find((org) => org.login === value);
  const hasOrgs = orgs.length > 0;

  const selectedIcon = selectedIsUser ? (
    <Avatar src={user?.avatarUrl} fallback={<UserIcon className="size-3" />} />
  ) : selectedOrg ? (
    <Avatar
      src={selectedOrg.avatarUrl}
      fallback={<Building2 className="size-3" />}
    />
  ) : user && !value ? (
    <Avatar src={user.avatarUrl} fallback={<UserIcon className="size-3" />} />
  ) : (
    <Avatar src={null} fallback={<UserIcon className="size-3" />} />
  );

  const triggerBody = value ? (
    <>
      {selectedIcon}
      <span className="truncate">{value}</span>
    </>
  ) : (
    <>
      {selectedIcon}
      <span className="truncate text-text-muted">
        {strings.settings.repository.fields.owner.select}
      </span>
    </>
  );

  // With orgs available (or still loading), allow opening. If we've loaded
  // and confirmed there are no orgs, render a locked field instead.
  const ownerIsPickable = hasOrgs || loading || !user;

  if (!ownerIsPickable) {
    return (
      <div
        className={cn(
          FIELD_TRIGGER_CLASS,
          'pointer-events-none cursor-default',
          disabled && 'opacity-60',
          className,
        )}
        aria-disabled="true"
      >
        {triggerBody}
        <Lock className="ml-auto size-3 shrink-0 text-text-muted" />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(FIELD_TRIGGER_CLASS, className)}
      >
        {triggerBody}
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-52">
        {loading && !user ? (
          <MenuLoadingRow
            label={strings.settings.repository.fields.owner.loading}
          />
        ) : (
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {user && (
              <DropdownMenuRadioItem value={user.login}>
                <Avatar
                  src={user.avatarUrl}
                  fallback={<UserIcon className="size-3" />}
                />
                <span className="truncate">{user.login}</span>
                <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-widest">
                  {strings.settings.repository.fields.owner.you}
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
                  {strings.settings.repository.fields.owner.org}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
