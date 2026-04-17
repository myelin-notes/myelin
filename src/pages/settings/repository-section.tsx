import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  Github,
  HardDrive,
  Loader2,
  LogOut,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  beginGitHubDeviceAuth,
  cancelGitHubDeviceAuth,
  clearGitHubToken,
  getRepositoryConfig,
  hasGitHubToken,
  isGitHubDeviceAuthAvailable,
  openGitHubDeviceAuth,
  type RepositoryConfig,
  setRepositoryConfig,
  subscribeRepositoryConfig,
  waitForGitHubDeviceAuth,
} from '@/lib/sync';
import { cn } from '@/lib/utils';

type RepoKind = RepositoryConfig['kind'];

function KindCard({
  selected,
  onSelect,
  icon: Icon,
  label,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative flex items-start gap-4 overflow-hidden rounded-xl p-5 transition-all duration-200',
          selected
            ? 'bg-white shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input hover:bg-white hover:shadow-ambient',
        )}
      >
        {selected && (
          <div className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-white" />
          </div>
        )}
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
            selected
              ? 'bg-accent-navy/10 text-accent-navy'
              : 'bg-hover-tint text-text-muted',
          )}
        >
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0">
          <span
            className={cn(
              'block font-medium text-sm transition-colors',
              selected ? 'text-accent-navy' : 'text-text-primary',
            )}
          >
            {label}
          </span>
          <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
            {description}
          </span>
        </div>
      </div>
    </button>
  );
}

function AuthStatusBadge({
  hasToken,
  checking,
  polling,
}: {
  hasToken: boolean;
  checking: boolean;
  polling: boolean;
}) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        Checking
      </span>
    );
  }

  if (polling) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
        <Loader2 className="size-3 animate-spin" />
        Authorizing
      </span>
    );
  }

  if (hasToken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/20 px-2.5 py-1 font-medium text-[10px] text-text-green uppercase tracking-widest">
        <span className="size-1.5 rounded-full bg-current" />
        Connected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] text-text-muted uppercase tracking-widest">
      <span className="size-1.5 rounded-full bg-current" />
      Not connected
    </span>
  );
}

function DeviceCodeDisplay({
  userCode,
  onCopy,
}: {
  userCode: string;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="flex items-center justify-between rounded-xl bg-white px-5 py-4 shadow-ambient ring-1 ring-border-subtle">
        <div>
          <p className="text-[10px] text-text-muted uppercase tracking-widest">
            Enter this code on GitHub
          </p>
          <p className="mt-1.5 font-mono font-semibold text-2xl text-accent-navy tracking-[0.25em]">
            {userCode}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          className="shrink-0"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <ClipboardCopy className="size-3.5" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </motion.div>
  );
}

export function RepositorySection() {
  const [config, setConfig] = useState<RepositoryConfig>(getRepositoryConfig);
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [polling, setPolling] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const credentialId =
    config.kind === 'github'
      ? config.credentialId.trim() || 'default'
      : 'default';

  useEffect(() => {
    return subscribeRepositoryConfig(setConfig);
  }, []);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const [available, has] = await Promise.all([
        isGitHubDeviceAuthAvailable(),
        hasGitHubToken(credentialId),
      ]);

      setAuthAvailable(available);
      setTokenPresent(has);
      if (has) {
        setAuthError(null);
      }
    } catch (error) {
      setTokenPresent(false);
      setAuthError(
        error instanceof Error
          ? error.message
          : 'Failed to read GitHub authentication state',
      );
    } finally {
      setCheckingToken(false);
    }
  }, [credentialId]);

  useEffect(() => {
    void checkToken();
  }, [checkToken]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleKindChange = (kind: RepoKind) => {
    if (kind === 'local') {
      setRepositoryConfig({ kind: 'local' });
    } else {
      setRepositoryConfig({
        kind: 'github',
        owner: config.kind === 'github' ? config.owner : '',
        repo: config.kind === 'github' ? config.repo : '',
        branch: config.kind === 'github' ? config.branch : 'main',
        credentialId,
      });
    }
  };

  const updateGitHubField = (
    field: 'owner' | 'repo' | 'branch',
    value: string,
  ) => {
    if (config.kind !== 'github') {
      return;
    }
    setRepositoryConfig({ ...config, [field]: value });
  };

  const handleSignIn = async () => {
    setAuthError(null);

    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;

    try {
      const payload = await beginGitHubDeviceAuth(credentialId);
      if (abort.signal.aborted) {
        return;
      }

      setUserCode(payload.userCode);
      setPolling(true);
      await openGitHubDeviceAuth(payload);

      const result = await waitForGitHubDeviceAuth(credentialId, {
        signal: abort.signal,
      });

      if (abort.signal.aborted) {
        return;
      }

      if (result.status === 'complete') {
        setTokenPresent(true);
        setAuthError(null);
      } else {
        setAuthError(result.error);
      }
    } catch (e) {
      if (abort.signal.aborted) {
        return;
      }
      setAuthError(e instanceof Error ? e.message : 'Failed to sign in');
    } finally {
      if (!abort.signal.aborted) {
        setPolling(false);
        setUserCode(null);
      }
    }
  };

  const handleCancelAuth = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPolling(false);
    setUserCode(null);
    try {
      await cancelGitHubDeviceAuth(credentialId);
    } catch {
      // best-effort cancel
    }
  };

  const handleSignOut = async () => {
    await clearGitHubToken(credentialId);
    setTokenPresent(false);
    setAuthError(null);
  };

  const authDescription = polling
    ? 'Enter the code on GitHub to finish signing in'
    : tokenPresent
      ? 'Signed in via GitHub'
      : !authAvailable
        ? 'GitHub authentication is unavailable'
        : 'Sign in with your GitHub account';

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">Repository</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          Sync
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KindCard
          selected={config.kind === 'local'}
          onSelect={() => handleKindChange('local')}
          icon={HardDrive}
          label="Local"
          description="Notes stored on this device only"
        />
        <KindCard
          selected={config.kind === 'github'}
          onSelect={() => handleKindChange('github')}
          icon={Github}
          label="GitHub"
          description="Sync to a private GitHub repository"
        />
      </div>

      <AnimatePresence initial={false}>
        {config.kind === 'github' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-input px-5 py-4">
                <div className="flex items-center gap-3">
                  <Github className="size-5 text-text-secondary" />
                  <div>
                    <p className="font-medium text-sm text-text-primary">
                      GitHub Authentication
                    </p>
                    <p className="mt-0.5 text-text-muted text-xs">
                      {authDescription}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <AuthStatusBadge
                    hasToken={tokenPresent}
                    checking={checkingToken}
                    polling={polling}
                  />
                  {tokenPresent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleSignOut()}
                      className="text-text-muted hover:text-destructive"
                    >
                      <LogOut className="size-3.5" />
                      Sign out
                    </Button>
                  ) : polling ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCancelAuth()}
                      className="text-text-muted"
                    >
                      <X className="size-3.5" />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSignIn()}
                      disabled={!authAvailable}
                    >
                      <ExternalLink className="size-3.5" />
                      Sign in
                    </Button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {userCode && (
                  <DeviceCodeDisplay userCode={userCode} onCopy={() => {}} />
                )}
              </AnimatePresence>

              {authError && (
                <p className="rounded-lg bg-destructive/5 px-4 py-2.5 text-destructive text-xs">
                  {authError}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-[10px] text-text-muted uppercase tracking-widest">
                    Owner
                  </label>
                  <Input
                    placeholder="username"
                    value={config.owner}
                    onChange={(e) => updateGitHubField('owner', e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] text-text-muted uppercase tracking-widest">
                    Repository
                  </label>
                  <Input
                    placeholder="my-notes"
                    value={config.repo}
                    onChange={(e) => updateGitHubField('repo', e.target.value)}
                  />
                </div>
              </div>
              <div className="max-w-[calc(50%-0.5rem)]">
                <label className="mb-1.5 block text-[10px] text-text-muted uppercase tracking-widest">
                  Branch
                </label>
                <Input
                  placeholder="main"
                  value={config.branch ?? ''}
                  onChange={(e) => updateGitHubField('branch', e.target.value)}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
