/**
 * Decentralized tag registry — the single source of truth for which tags
 * exist, independent of any file or folder. Backed by UserPrefs (localStorage)
 * so created tags are reusable and survive being detached from every node.
 *
 * Tags already attached to nodes are seeded in on load via addRegistryTags, so
 * the registry stays a superset of every node's tags and callers never need to
 * merge two lists — the list is always getRegistryTags(). Per-tag file counts
 * are looked up from the repository separately, for display only. Frontend-only.
 */

import { normalizeTagInput } from '@/lib/sync/repo/tag-hierarchy';
import { UserPrefs } from '@/lib/user-prefs';

export function getRegistryTags(): string[] {
  return UserPrefs.get('tagRegistry');
}

export function addRegistryTags(tags: string[]): void {
  const normalized = tags
    .map(normalizeTagInput)
    .filter((tag) => tag.length > 0);
  if (normalized.length === 0) {
    return;
  }
  UserPrefs.update('tagRegistry', (current) => {
    const next = new Set(current);
    for (const tag of normalized) {
      next.add(tag);
    }
    return next.size === current.length ? current : [...next];
  });
}

export function removeRegistryTag(tag: string): void {
  UserPrefs.update('tagRegistry', (current) =>
    current.filter((entry) => entry !== tag),
  );
}
