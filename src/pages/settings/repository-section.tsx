import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check,
  ExternalLink,
  Github,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  clearGitHubToken,
  hasGitHubToken,
  isGitHubSecureStorageAvailable,
  storeGitHubToken,
  type RepositoryConfig,
  getRepositoryConfig,
  setRepositoryConfig,
  subscribeRepositoryConfig,
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
              'block text-sm font-medium transition-colors',
              selected ? 'text-accent-navy' : 'text-text-primary',
            )}
          >
            {label}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
            {description}
          </span>
        </div>
      </div>
    </button>
  );
}

function TokenStatusBadge({
  hasToken,
  checking,
}: {
  hasToken: boolean;
  checking: boolean;
}) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted">
        <Loader2 className="size-3 animate-spin" />
        Checking
      </span>
    );
  }

  if (hasToken) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-text-green">
        <span className="size-1.5 rounded-full bg-current" />
        Connected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-hover-tint px-2.5 py-1 text-[10px] uppercase tracking-widest text-text-muted">
      <span className="size-1.5 rounded-full bg-current" />
      Not connected
    </span>
  );
}

function TokenDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (token: string) => void;
}) {
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = token.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    try {
      onSubmit(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save token');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setToken('');
      setError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>GitHub Personal Access Token</DialogTitle>
          <DialogDescription>
            Create a{' '}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Myelin"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-navy underline underline-offset-3"
            >
              fine-grained token
              <ExternalLink className="size-3" />
            </a>{' '}
            with <strong>Contents</strong> read &amp; write access to your
            repository. The token is stored securely in your system keychain.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="relative">
            <KeyRound className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              className="pl-8"
              autoFocus
            />
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <X className="size-3" />
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!token.trim() || saving}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RepositorySection() {
  const [config, setConfig] = useState<RepositoryConfig>(getRepositoryConfig);
  const [tokenPresent, setTokenPresent] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [secureAvailable, setSecureAvailable] = useState(true);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  const credentialId =
    config.kind === 'github' ? config.credentialId || 'default' : 'default';

  useEffect(() => {
    return subscribeRepositoryConfig(setConfig);
  }, []);

  const checkToken = useCallback(async () => {
    setCheckingToken(true);
    try {
      const available = await isGitHubSecureStorageAvailable();
      setSecureAvailable(available);
      if (available) {
        const has = await hasGitHubToken(credentialId);
        setTokenPresent(has);
      }
    } catch {
      setTokenPresent(false);
    } finally {
      setCheckingToken(false);
    }
  }, [credentialId]);

  useEffect(() => {
    void checkToken();
  }, [checkToken]);

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
    if (config.kind !== 'github') return;
    setRepositoryConfig({ ...config, [field]: value });
  };

  const handleTokenSubmit = async (token: string) => {
    await storeGitHubToken(credentialId, token);
    setTokenPresent(true);
    setTokenDialogOpen(false);
  };

  const handleSignOut = async () => {
    await clearGitHubToken(credentialId);
    setTokenPresent(false);
  };

  return (
    <section>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">Repository</h3>
        <span className="text-[10px] uppercase tracking-widest text-text-muted">
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
            <div className="mt-5 space-y-5">
              {/* Token / Auth */}
              <div className="flex items-center justify-between rounded-xl bg-input px-5 py-4">
                <div className="flex items-center gap-3">
                  <Github className="size-5 text-text-secondary" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      GitHub Authentication
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {!secureAvailable
                        ? 'Secure storage unavailable on this device'
                        : tokenPresent
                          ? 'Personal access token stored in keychain'
                          : 'Sign in to connect your repository'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <TokenStatusBadge
                    hasToken={tokenPresent}
                    checking={checkingToken}
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
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTokenDialogOpen(true)}
                      disabled={!secureAvailable}
                    >
                      <KeyRound className="size-3.5" />
                      Sign in
                    </Button>
                  )}
                </div>
              </div>

              {/* Repo fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-text-muted">
                    Owner
                  </label>
                  <Input
                    placeholder="username"
                    value={config.owner}
                    onChange={(e) =>
                      updateGitHubField('owner', e.target.value)
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-text-muted">
                    Repository
                  </label>
                  <Input
                    placeholder="my-notes"
                    value={config.repo}
                    onChange={(e) =>
                      updateGitHubField('repo', e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="max-w-[calc(50%-0.5rem)]">
                <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-text-muted">
                  Branch
                </label>
                <Input
                  placeholder="main"
                  value={config.branch ?? ''}
                  onChange={(e) =>
                    updateGitHubField('branch', e.target.value)
                  }
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <TokenDialog
        open={tokenDialogOpen}
        onOpenChange={setTokenDialogOpen}
        onSubmit={(token) => void handleTokenSubmit(token)}
      />
    </section>
  );
}
