import { useEffect, useState } from 'react';
import { Logger } from '@myelin/shared/logger';
import {
  useRepository,
  useRepositoryStatus,
  type VFSFileNode,
  type VFSNodeId,
} from '@/lib/sync';

const logger = new Logger('Templates');

export interface TemplatesState {
  /** `null` until the first template is saved or imported. */
  rootId: VFSNodeId | null;
  /** Sorted by name. */
  templates: VFSFileNode[];
}

const NO_TEMPLATES: TemplatesState = { rootId: null, templates: [] };

export function useTemplates(): TemplatesState {
  const repository = useRepository();
  const { dataVersion } = useRepositoryStatus();
  const [state, setState] = useState(NO_TEMPLATES);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataVersion is a change trigger
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await repository.getTemplatesRoot();
        const templates = root
          ? (await repository.listDirectory(root.id))[1].sort((a, b) =>
              a.name.localeCompare(b.name),
            )
          : [];
        if (!cancelled) {
          setState({ rootId: root?.id ?? null, templates });
        }
      } catch (error) {
        logger.error('Failed to load templates', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, dataVersion]);

  return state;
}
