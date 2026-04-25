import type { Repository } from '@/lib/sync';

export type NoteLinkSearchSource = Pick<Repository, 'searchNodes'>;

// todo: probably can avoid searching
export async function resolveNoteLinkIdByTitle(
  repository: NoteLinkSearchSource,
  title: string,
): Promise<string | null> {
  const matches = await repository.searchNodes(title);
  const match = matches.find(
    (node) =>
      node.type === 'file' &&
      node.fileType === 'mcanvas' &&
      node.name === title,
  );
  return match?.id ?? null;
}
