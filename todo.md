# ToolOption and setOption. Why not include a setter?
```ts
export type ToolOption =
  ({
      type: 'color';
      key: string;
      label: string;
      value: string;
      palette: string[];
      set: (color: string) => void;
    }
  | {
      type: 'size';
      key: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      ...
    }
  | {
      type: 'font';
      key: string;
      label: string;
      value: string;
      fonts: FontEntry[];
    }
  | {
      type: 'choice';
      key: string;
      label: string;
      value: string;
      choices: { value: string; label: string; icon?: LucideIcon }[];
    });
```

# useCanvasEngine is way too big
can we separate this into a few diff hooks?

# frame chrome indirection
```ts
  const chrome = new FrameChrome({
    kindLabel: 'NOTE',
    getMenuItems: () => frame.getMenuItems(),
  });
  chrome.root.dataset.frameIndex = String(frame.index);
```

use of dataset makes this really confusing to follow

# does each drawable element still need an index
It was migrated from an old system but do we still need it now?

# Why is UserPrefs an object?
why not just a namespace? seems more semantically correct

# setup proper logging system

# instead of peer state being an interface, use class?
instead of it being an interface with a bunch of functions that operate on it why dont we just make it a class?

# why in iroh.ts and sessions.ts we reference globalThis?

# document sync/types.ts types

# make LOCAL_ORIGIN and PEER_ORIGIN type safe?

# function that makes no sense in NoteSession
```ts
  hasLocalChanges(): boolean {
    return this.hasRemoteChanges();
  }
```