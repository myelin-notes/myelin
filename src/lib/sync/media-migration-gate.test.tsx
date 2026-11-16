import type { PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '@myelin/editor/i18n';
import { RepositoryMediaMigrationGate } from './media-migration-gate';
import {
  RepositoryContext,
  type RepositoryContextValue,
  type RepositoryStatus,
} from './repo-context';

// The real dialog portals into a document, which these Node tests do not have.
vi.mock('@/components/ui/dialog', () => {
  const passthrough = ({ children }: PropsWithChildren) => (
    <div>{children}</div>
  );
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});

function render(patch: Partial<RepositoryStatus>): string {
  const status = {
    online: true,
    lastError: null,
    mediaMigration: null,
    ...patch,
  } as RepositoryStatus;
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <RepositoryContext.Provider
        value={{ status } as unknown as RepositoryContextValue}
      >
        <RepositoryMediaMigrationGate />
      </RepositoryContext.Provider>
    </I18nProvider>,
  );
}

const ESCAPE = 'Continue without waiting';

it('shows nothing when no migration is running', () => {
  expect(render({})).toBe('');
});

it('blocks with no way out while the migration is making progress', () => {
  const counting = render({ mediaMigration: { completed: 0, total: 0 } });
  expect(counting).toContain('Optimizing storage');
  expect(counting).toContain('Preparing');
  expect(counting).not.toContain(ESCAPE);

  const running = render({ mediaMigration: { completed: 12, total: 300 } });
  expect(running).toContain('12 of 300 documents');
  expect(running).toContain('update Myelin on your other devices');
  expect(running).not.toContain(ESCAPE);

  const uploading = render({ mediaMigration: { completed: 300, total: 300 } });
  expect(uploading).toContain('Finishing upload');
  expect(uploading).not.toContain(ESCAPE);
});

// Signing back in is behind the dialog, so without a way out an expired token locks the app.
it('offers a way out once the repository cannot be reached', () => {
  const mediaMigration = { completed: 12, total: 300 };
  expect(render({ mediaMigration, online: false })).toContain(ESCAPE);
  expect(
    render({ mediaMigration, lastError: new Error('GitHub sign-in expired') }),
  ).toContain(ESCAPE);
});
