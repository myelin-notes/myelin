/**
 * Tauri-free subset of the sync barrel, now sourced from `@myelin/editor`.
 * The only app-side addition: `Repository` is shadowed with the app's
 * extension (adds `openSession`), so app code importing from here keeps the
 * full contract.
 */

export * from '@myelin/editor/sync/core';
export type { Repository } from './repo/types';
