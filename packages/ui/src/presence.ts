import { type AnimationEventHandler, useState } from 'react';

export type PresenceStatus = 'open' | 'closed';

/** Base UI-style boolean state attributes, spreadable onto any element. */
export type PresenceState = { 'data-open': '' } | { 'data-closed': '' };

export interface Presence {
  /** Whether to render the element. Stays true while the exit animation plays. */
  mounted: boolean;
  status: PresenceStatus;
  /**
   * Spread onto every element that should animate — drives the
   * `data-open:`/`data-closed:` tw-animate-css variants.
   */
  state: PresenceState;
  /**
   * Spread onto the single element whose closing animation gates unmount
   * (alongside `state`). Unmounts once its `data-closed:animate-out` ends.
   */
  onAnimationEnd: AnimationEventHandler;
}

/**
 * Mount-persistence for CSS enter/exit animations, matching Base UI's
 * data-open/data-closed convention (see src/components/ui/dialog.tsx). Keeps a
 * conditionally-rendered element in the DOM while its `data-closed:animate-out`
 * class plays, then unmounts it. Replaces motion's `<AnimatePresence>` for
 * simple `{present && <el/>}` renders.
 *
 * The element carrying `onAnimationEnd` must have a closing animation class or
 * it will never unmount. The event is guarded so nested child animations don't
 * unmount the parent early.
 */
export function usePresence(present: boolean): Presence {
  const [mounted, setMounted] = useState(present);

  if (present && !mounted) {
    setMounted(true);
  }

  const onAnimationEnd: AnimationEventHandler = (event) => {
    if (!present && event.target === event.currentTarget) {
      setMounted(false);
    }
  };

  return {
    mounted,
    status: present ? 'open' : 'closed',
    state: present ? { 'data-open': '' } : { 'data-closed': '' },
    onAnimationEnd,
  };
}
