import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  GripHorizontal as GripHorizontalIcon,
  GripVertical as GripVerticalIcon,
  Trash2 as TrashIcon,
  X as XIcon,
} from 'lucide-react';
import { PenPresetMark } from '@myelin/editor/components/pen-preset-mark';
import { useMessages } from '@myelin/editor/i18n';
import { getPenPresetLabel } from '@myelin/editor/pen-presets';
import type { PenPreset } from '@myelin/editor/sync/repo/types';
import {
  type PresetToolbarPosition,
  UserPrefs,
} from '@myelin/editor/user-prefs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useUserPref } from '@/lib/use-user-pref';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';

interface PresetToolbarProps {
  presets: PenPreset[];
  activePresetId: string | null;
  onEditPreset: (preset: PenPreset) => void;
  onDeletePreset: (preset: PenPreset) => void;
  onReorderPresets: (ids: readonly string[]) => Promise<void>;
}

const PRESET_DRAG_HOLD_MS = 300;
const PRESET_DRAG_SLOP_PX = 8;
const VIEWPORT_MARGIN = 16;
// Dragging the grip within this distance of a side edge turns the bar vertical.
const VERTICAL_EDGE_PX = 80;
// Level with the title bar's top-6.
const DEFAULT_TOP = 24;
// Clears the compact tool bar and the undo/redo row stacked above it.
const PHONE_DEFAULT_BOTTOM = 144;
const DELETE_ZONE_WIDTH = 128;
const DELETE_ZONE_HEIGHT = 80;
const DELETE_ZONE_GAP = 12;

export const PresetToolbar = memo(function PresetToolbar({
  presets,
  activePresetId,
  onEditPreset,
  onDeletePreset,
  onReorderPresets,
}: PresetToolbarProps) {
  const strings = useMessages();
  const savedPosition = useUserPref('presetToolbarPosition');
  const [movePosition, setMovePosition] =
    useState<PresetToolbarPosition | null>(null);
  const position = movePosition ?? savedPosition;
  const vertical = position?.vertical ?? false;
  const barRef = useRef<HTMLDivElement>(null);
  const moveOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const presetDeleteZoneRef = useRef<HTMLDivElement>(null);
  const [presetDragOrder, setPresetDragOrder] = useState<string[] | null>(null);
  const [presetDragging, setPresetDragging] = useState(false);
  const [presetDeleteZone, setPresetDeleteZone] = useState({ left: 0, top: 0 });
  const [presetDeleteTargeted, setPresetDeleteTargeted] = useState(false);
  const presetHoldTimerRef = useRef<number | null>(null);
  const presetDragIdRef = useRef<string | null>(null);
  const presetPointerIdRef = useRef<number | null>(null);
  const presetPointerStartRef = useRef({ x: 0, y: 0 });
  const suppressPresetClickRef = useRef(false);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const container = bar?.offsetParent;
    if (!(bar && container)) {
      return;
    }

    const syncPosition = () => {
      const { clientWidth: width, clientHeight: height } = container;
      const left = position
        ? position.x * width
        : (width - bar.offsetWidth) / 2;
      const top = position
        ? position.y * height
        : IS_PHONE_BUILD
          ? height - bar.offsetHeight - PHONE_DEFAULT_BOTTOM
          : DEFAULT_TOP;
      bar.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, width - bar.offsetWidth - VIEWPORT_MARGIN))}px`;
      bar.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, height - bar.offsetHeight - VIEWPORT_MARGIN))}px`;
    };

    syncPosition();
    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(bar);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [position]);

  const beginMove = (event: React.PointerEvent<HTMLElement>) => {
    const bar = barRef.current;
    if (!(event.isPrimary && event.button === 0 && bar)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = bar.getBoundingClientRect();
    moveOffsetRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const offset = moveOffsetRef.current;
    const container = barRef.current?.offsetParent;
    if (!(offset && container)) {
      return;
    }
    const bounds = container.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    // Unclamped, so a bar pushed against an edge stays there as the window grows.
    setMovePosition({
      x: (pointerX - offset.x) / bounds.width,
      y: (event.clientY - bounds.top - offset.y) / bounds.height,
      vertical:
        pointerX < VERTICAL_EDGE_PX ||
        pointerX > bounds.width - VERTICAL_EDGE_PX,
    });
  };

  const endMove = () => {
    moveOffsetRef.current = null;
    if (movePosition) {
      UserPrefs.set('presetToolbarPosition', movePosition);
      setMovePosition(null);
    }
  };

  const clearPresetHold = () => {
    if (presetHoldTimerRef.current !== null) {
      window.clearTimeout(presetHoldTimerRef.current);
      presetHoldTimerRef.current = null;
    }
  };

  const isOverPresetDeleteZone = (clientX: number, clientY: number) => {
    const bounds = presetDeleteZoneRef.current?.getBoundingClientRect();
    return Boolean(
      bounds &&
        clientX >= bounds.left &&
        clientX <= bounds.right &&
        clientY >= bounds.top &&
        clientY <= bounds.bottom,
    );
  };

  useEffect(
    () => () => {
      if (presetHoldTimerRef.current !== null) {
        window.clearTimeout(presetHoldTimerRef.current);
      }
    },
    [],
  );

  // The zone opens on the side of the bar facing the middle of the window.
  const getPresetDeleteZone = (pointerX: number, pointerY: number) => {
    const bar = barRef.current?.getBoundingClientRect();
    if (!bar) {
      return { left: 0, top: 0 };
    }
    if (vertical) {
      return {
        left:
          bar.left + bar.width / 2 < window.innerWidth / 2
            ? bar.right + DELETE_ZONE_GAP
            : bar.left - DELETE_ZONE_GAP - DELETE_ZONE_WIDTH,
        top: Math.min(
          Math.max(pointerY - DELETE_ZONE_HEIGHT / 2, VIEWPORT_MARGIN),
          window.innerHeight - DELETE_ZONE_HEIGHT - VIEWPORT_MARGIN,
        ),
      };
    }
    return {
      left: Math.min(
        Math.max(pointerX - DELETE_ZONE_WIDTH / 2, VIEWPORT_MARGIN),
        window.innerWidth - DELETE_ZONE_WIDTH - VIEWPORT_MARGIN,
      ),
      top:
        bar.top + bar.height / 2 < window.innerHeight / 2
          ? bar.bottom + DELETE_ZONE_GAP
          : bar.top - DELETE_ZONE_GAP - DELETE_ZONE_HEIGHT,
    };
  };

  const beginPresetHold = (
    event: React.PointerEvent<HTMLElement>,
    presetId: string,
  ) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    event.stopPropagation();
    clearPresetHold();
    presetPointerIdRef.current = event.pointerId;
    presetPointerStartRef.current = { x: event.clientX, y: event.clientY };
    const deleteZone = getPresetDeleteZone(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    presetHoldTimerRef.current = window.setTimeout(() => {
      presetHoldTimerRef.current = null;
      presetDragIdRef.current = presetId;
      suppressPresetClickRef.current = true;
      setPresetDeleteZone(deleteZone);
      setPresetDragging(true);
      setPresetDragOrder(presets.map((preset) => preset.id));
    }, PRESET_DRAG_HOLD_MS);
  };

  const movePresetDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerId !== presetPointerIdRef.current) {
      return;
    }
    const dragId = presetDragIdRef.current;
    if (!dragId) {
      const distance = Math.hypot(
        event.clientX - presetPointerStartRef.current.x,
        event.clientY - presetPointerStartRef.current.y,
      );
      if (distance > PRESET_DRAG_SLOP_PX) {
        clearPresetHold();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const overDeleteZone = isOverPresetDeleteZone(event.clientX, event.clientY);
    setPresetDeleteTargeted(overDeleteZone);
    if (overDeleteZone) {
      return;
    }
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-preset-id]');
    const targetId = target?.dataset.presetId;
    if (!targetId || targetId === dragId) {
      return;
    }
    setPresetDragOrder((current) => {
      if (!current) {
        return current;
      }
      const from = current.indexOf(dragId);
      const to = current.indexOf(targetId);
      if (from < 0 || to < 0) {
        return current;
      }
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      return next;
    });
  };

  const endPresetDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerId !== presetPointerIdRef.current) {
      return;
    }
    clearPresetHold();
    presetPointerIdRef.current = null;
    const draggedPresetId = presetDragIdRef.current;
    presetDragIdRef.current = null;
    if (!draggedPresetId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPresetDragging(false);
    const order = presetDragOrder;
    window.setTimeout(() => {
      suppressPresetClickRef.current = false;
    });
    setPresetDeleteTargeted(false);
    if (isOverPresetDeleteZone(event.clientX, event.clientY)) {
      const draggedPreset = presets.find(
        (preset) => preset.id === draggedPresetId,
      );
      setPresetDragOrder(null);
      if (draggedPreset) {
        onDeletePreset(draggedPreset);
      }
      return;
    }
    const orderChanged = order?.some((id, index) => presets[index]?.id !== id);
    if (order && orderChanged) {
      void onReorderPresets(order).finally(() => setPresetDragOrder(null));
    } else {
      setPresetDragOrder(null);
    }
  };

  const cancelPresetDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerId !== presetPointerIdRef.current) {
      return;
    }
    clearPresetHold();
    presetPointerIdRef.current = null;
    presetDragIdRef.current = null;
    suppressPresetClickRef.current = false;
    setPresetDragging(false);
    setPresetDeleteTargeted(false);
    setPresetDragOrder(null);
  };

  const orderedPresets = presetDragOrder
    ? presetDragOrder.flatMap((id) => {
        const preset = presets.find((entry) => entry.id === id);
        return preset ? [preset] : [];
      })
    : presets;
  // 44px touch target on compact, against 36px for a cursor.
  const buttonPadClass = IS_PHONE_BUILD ? 'p-3.5' : 'p-2.5';
  const gripSize = IS_PHONE_BUILD ? 28 : 20;
  const GripIcon = vertical ? GripHorizontalIcon : GripVerticalIcon;

  return (
    <TooltipProvider>
      {presetDragging && (
        <div
          ref={presetDeleteZoneRef}
          className={`pointer-events-none fixed z-[101] flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 font-medium text-xs shadow-ambient backdrop-blur-md transition-[color,background-color,border-color,transform] ${
            presetDeleteTargeted
              ? 'scale-105 border-destructive bg-destructive text-text-on-dark'
              : 'border-destructive/50 bg-card/95 text-destructive'
          }`}
          style={{
            ...presetDeleteZone,
            width: DELETE_ZONE_WIDTH,
            minHeight: DELETE_ZONE_HEIGHT,
          }}
        >
          <TrashIcon className="size-5" />
          <span>{strings.canvas.toolPresets.delete}</span>
        </div>
      )}
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Pen presets"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        className={`fade-in-0 absolute z-[100] flex animate-in items-center gap-1 overflow-auto rounded-xl bg-card p-2 ring-1 ring-border-subtle/70 transition-none duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          vertical
            ? 'max-h-[calc(100%-2rem)] flex-col'
            : 'max-w-[calc(100%-2rem)]'
        }`}
      >
        <div
          aria-hidden
          className="flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-md text-text-muted transition-colors hover:bg-hover-tint active:cursor-grabbing"
          style={vertical ? { height: gripSize } : { width: gripSize }}
          onPointerDown={beginMove}
          onPointerMove={move}
          onPointerUp={endMove}
          onPointerCancel={endMove}
        >
          <GripIcon className="size-4" />
        </div>

        {orderedPresets.map((preset) => {
          const isMatch = activePresetId === preset.id;
          const isDragging = presetDragIdRef.current === preset.id;
          return (
            <div key={preset.id} className="group relative shrink-0">
              <Tooltip disabled={presetDragging}>
                <TooltipTrigger
                  data-preset-id={preset.id}
                  aria-label={getPenPresetLabel(preset, strings)}
                  className={`touch-none rounded-lg ${buttonPadClass} transition-[color,background-color,opacity,transform] ${
                    isDragging
                      ? 'scale-110 cursor-grabbing opacity-70'
                      : 'cursor-pointer'
                  } ${
                    isMatch
                      ? 'bg-accent-dark'
                      : 'bg-transparent hover:bg-hover-tint'
                  }`}
                  onPointerDown={(event) => beginPresetHold(event, preset.id)}
                  onPointerMove={movePresetDrag}
                  onPointerUp={endPresetDrag}
                  onPointerCancel={cancelPresetDrag}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (suppressPresetClickRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    onEditPreset(preset);
                  }}
                >
                  <PenPresetMark
                    preset={preset}
                    onDark={isMatch}
                    className="size-4"
                  />
                </TooltipTrigger>
                <TooltipContent side={vertical ? 'right' : 'bottom'}>
                  <p>{getPenPresetLabel(preset, strings)}</p>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                aria-label={`${strings.canvas.toolPresets.delete}: ${getPenPresetLabel(preset, strings)}`}
                title={strings.canvas.toolPresets.delete}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeletePreset(preset);
                }}
                className="pointer-events-none absolute -top-1 -right-1 flex size-3.5 cursor-pointer items-center justify-center rounded-full border-none bg-card p-0 text-text-secondary opacity-0 shadow-ambient transition-opacity duration-100 hover:text-text-primary focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                style={{
                  boxShadow: 'inset 0 0 0 0.5px var(--border-ghost)',
                }}
              >
                <XIcon className="size-2.5" strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
});
