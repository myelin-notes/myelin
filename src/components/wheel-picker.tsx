import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { SvgIcon } from '@/pages/canvas/tools/tool';

const TWO_PI = 2 * Math.PI;
const CENTER_ZONE = 40;
const SUB_SPACING = 0.16; // radians between sub-items

export interface WheelItem {
  label: string;
  icon?: SvgIcon;
  color?: string;
  dot?: number;
  command?: () => void;
  children?: WheelItem[];
}

export interface WheelPickerHandle {
  show: (event: PointerEvent) => void;
  hide: () => void;
}

interface WheelPickerProps {
  ref?: React.Ref<WheelPickerHandle>;
  radius: number;
  items: WheelItem[];
  children?: React.ReactNode;
  onCenterClicked?: () => void;
}

/* ── Geometry helpers ──────────────────────────────── */

function pointerAngle(dx: number, dy: number): number {
  return Math.atan2(-dy, -dx) + Math.PI;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  if (d > Math.PI) {
    d -= TWO_PI;
  }
  if (d < -Math.PI) {
    d += TWO_PI;
  }
  return d;
}

function angleToIndex(angle: number, count: number): number {
  if (count === 0) {
    return -1;
  }
  const delta = TWO_PI / count;
  let t = angle + delta / 2;
  if (t >= TWO_PI) {
    t -= TWO_PI;
  }
  return Math.min(Math.floor(t / delta), count - 1);
}

function childAngleOf(
  parentAngle: number,
  index: number,
  count: number,
): number {
  const totalArc = SUB_SPACING * (count - 1);
  return parentAngle - totalArc / 2 + SUB_SPACING * index;
}

function angleToChildIndex(
  angle: number,
  parentAngle: number,
  count: number,
): number | null {
  if (count === 0) {
    return null;
  }
  const diff = angleDiff(angle, parentAngle);
  const totalArc = SUB_SPACING * (count - 1);
  const halfExtent = totalArc / 2 + SUB_SPACING / 2;
  if (Math.abs(diff) > halfExtent) {
    return null;
  }
  const idx = Math.floor((diff + totalArc / 2 + SUB_SPACING / 2) / SUB_SPACING);
  return Math.max(0, Math.min(count - 1, idx));
}

function pos(angle: number, r: number): [number, number] {
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

function pathsEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/* ── Component ─────────────────────────────────────── */

export function WheelPicker({
  radius,
  items,
  children,
  onCenterClicked,
  ref,
}: WheelPickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const centerRef = useRef([0, 0]);
  const focusPathRef = useRef<number[]>([]);
  const [focusPath, setFocusPath] = useState<number[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Ring radii (for rendering)
  const R1 = radius + 60;
  const R2 = R1 + 55;

  const show = useCallback(
    (event: PointerEvent) => {
      if (items.length === 0) {
        return;
      }
      // Clamp center within viewport so outermost ring (R2) stays on-screen.
      // Pointer still tracks absolute motion against the clamped center.
      const outer = radius + 60 + 55 + 24;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = Math.min(Math.max(event.clientX, outer), vw - outer);
      const cy = Math.min(Math.max(event.clientY, outer), vh - outer);
      if (groupRef.current) {
        groupRef.current.style.left = `${cx}px`;
        groupRef.current.style.top = `${cy}px`;
      }
      setVisible(true);
      centerRef.current = [cx, cy];
      focusPathRef.current = [];
      setFocusPath([]);
    },
    [items.length, radius],
  );

  const hide = useCallback(() => {
    setVisible(false);
    focusPathRef.current = [];
    setFocusPath([]);
  }, []);

  useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

  /* ── Pointer tracking ────────────────────────────── */

  useEffect(() => {
    if (!visible) {
      return;
    }

    // Geometry for hit-testing (derived from radius)
    const r1 = radius + 60;
    const r2 = r1 + 55;
    const r0Outer = (radius + r1) / 2;
    const r1Outer = (r1 + r2) / 2;

    function updateFocus(path: number[]) {
      if (pathsEqual(focusPathRef.current, path)) {
        return;
      }
      focusPathRef.current = path;
      setFocusPath([...path]);
    }

    function handlePointerMove(evt: PointerEvent) {
      const its = itemsRef.current;
      if (its.length === 0) {
        return;
      }

      const [cx, cy] = centerRef.current;
      const dx = evt.clientX - cx;
      const dy = evt.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = pointerAngle(dx, dy);
      const fp = focusPathRef.current;
      const count = its.length;
      const delta = TWO_PI / count;

      // Center zone
      if (dist < CENTER_ZONE) {
        updateFocus([]);
        return;
      }

      // Ring 0
      if (dist < r0Outer) {
        const idx = angleToIndex(angle, count);
        if (idx >= 0) {
          updateFocus([idx]);
        }
        return;
      }

      // Beyond ring 0 — try deeper rings, fall back to ring 0

      // Try ring 2
      if (dist > r1Outer && fp.length >= 2) {
        const p0 = fp[0];
        const p1 = fp[1];
        const l1 = its[p0]?.children;
        const l2 = l1?.[p1]?.children;
        if (l2 && l2.length > 0) {
          const p0Angle = delta * p0;
          const p1Angle = childAngleOf(p0Angle, p1, l1!.length);
          const r2Idx = angleToChildIndex(angle, p1Angle, l2.length);
          if (r2Idx != null) {
            updateFocus([p0, p1, r2Idx]);
            return;
          }
        }
      }

      // Try ring 1
      if (fp.length >= 1) {
        const p0 = fp[0];
        const l1 = its[p0]?.children;
        if (l1 && l1.length > 0) {
          const p0Angle = delta * p0;
          const r1Idx = angleToChildIndex(angle, p0Angle, l1.length);
          if (r1Idx != null) {
            updateFocus([p0, r1Idx]);
            return;
          }
        }
      }

      // Fallback: ring 0
      const idx = angleToIndex(angle, count);
      if (idx >= 0) {
        updateFocus([idx]);
      }
    }

    function handlePointerUp(evt: PointerEvent) {
      if (evt.pointerType !== 'mouse') {
        return;
      }

      const its = itemsRef.current;
      const fp = focusPathRef.current;

      // Collect commands along the focus path
      const commands: (() => void)[] = [];
      let current: WheelItem[] | undefined = its;
      for (const idx of fp) {
        if (!current?.[idx]) {
          break;
        }
        if (current[idx].command) {
          commands.push(current[idx].command!);
        }
        current = current[idx].children;
      }

      // Execute leaf-to-root (options before tool switch)
      for (let i = commands.length - 1; i >= 0; i--) {
        commands[i]();
      }

      setVisible(false);
      focusPathRef.current = [];
      setFocusPath([]);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [visible, radius]);

  /* ── Derived rendering data ──────────────────────── */

  const count = items.length;
  const delta = count > 0 ? TWO_PI / count : TWO_PI;

  const r0Idx = focusPath[0];
  const l1Items = r0Idx != null ? items[r0Idx]?.children : undefined;
  const r0Angle = r0Idx != null ? delta * r0Idx : 0;

  const r1Idx = focusPath[1];
  const l2Items =
    r1Idx != null && l1Items ? l1Items[r1Idx]?.children : undefined;
  const r1Angle =
    r1Idx != null && l1Items ? childAngleOf(r0Angle, r1Idx, l1Items.length) : 0;

  /* ── Render ──────────────────────────────────────── */

  return (
    <div
      ref={groupRef}
      className="absolute top-0 left-0"
      onContextMenu={(e) => e.preventDefault()}
    >
      {visible && (
        <div
          data-wheel-container
          className="fade-in relative top-0 left-0 animate-in duration-150"
        >
          {/* Center button */}
          <button
            className="absolute top-0 left-0 flex size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl bg-accent-dark shadow-ambient outline-none"
            onClick={onCenterClicked}
          >
            {children}
          </button>

          {/* Ring 0: Tool icons */}
          {items.map((item, i) => {
            const [x, y] = pos(delta * i, radius);
            const Icon = item.icon;
            const inPath = focusPath[0] === i;
            return (
              <button
                key={i}
                className={`absolute flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl bg-white/85 shadow-ambient outline-none backdrop-blur-xl transition-colors ${
                  inPath ? 'bg-secondary-container' : ''
                }`}
                style={{ left: x, top: y }}
                title={item.label}
              >
                {Icon && (
                  <Icon
                    className={`size-4 ${inPath ? 'text-text-primary' : 'text-text-secondary'}`}
                  />
                )}
              </button>
            );
          })}

          {/* Ring 1: Sub-items (colors or size presets) */}
          {l1Items?.map((child, j) => {
            const cAngle = childAngleOf(r0Angle, j, l1Items.length);
            const [x, y] = pos(cAngle, R1);
            const focused = focusPath[1] === j;
            const isColor = !!child.color;
            const ChildIcon = child.icon;

            return (
              <button
                key={`r1-${r0Idx}-${j}`}
                className={`fade-in zoom-in-75 absolute flex animate-in cursor-pointer items-center justify-center rounded-xl shadow-ambient outline-none transition-all duration-100 ${
                  isColor
                    ? 'size-7 border-none p-0'
                    : `size-9 bg-white/85 backdrop-blur-xl ${focused ? 'bg-secondary-container' : ''}`
                }`}
                style={{
                  left: x,
                  top: y,
                  animationDelay: `${j * 15}ms`,
                  animationFillMode: 'both',
                  transform: `translate(-50%,-50%)${focused ? ' scale(1.15)' : ''}`,
                  ...(isColor
                    ? {
                        backgroundColor: child.color,
                        boxShadow: focused
                          ? '0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3.5px rgba(25,28,30,0.3)'
                          : 'inset 0 0 0 1px rgba(25,28,30,0.06), 0 0 32px 0 rgba(25,28,30,0.06)',
                      }
                    : {}),
                }}
                title={child.label}
              >
                {ChildIcon && (
                  <ChildIcon
                    className={`size-4 ${focused ? 'text-text-primary' : 'text-text-secondary'}`}
                  />
                )}
                {ChildIcon == null && child.dot != null && (
                  <span
                    className={`block rounded-full ${focused ? 'bg-text-primary' : 'bg-text-secondary'}`}
                    style={{ width: child.dot, height: child.dot }}
                  />
                )}
              </button>
            );
          })}

          {/* Ring 2: Sub-sub-items (size presets under a color) */}
          {l2Items?.map((gc, k) => {
            const gcAngle = childAngleOf(r1Angle, k, l2Items.length);
            const [x, y] = pos(gcAngle, R2);
            const focused = focusPath[2] === k;

            return (
              <button
                key={`r2-${r0Idx}-${r1Idx}-${k}`}
                className="fade-in zoom-in-75 absolute flex size-9 animate-in cursor-pointer items-center justify-center rounded-xl bg-white/85 shadow-ambient outline-none backdrop-blur-xl transition-all duration-100"
                style={{
                  left: x,
                  top: y,
                  animationDelay: `${k * 15}ms`,
                  animationFillMode: 'both',
                  transform: `translate(-50%,-50%)${focused ? ' scale(1.15)' : ''}`,
                  ...(focused
                    ? { backgroundColor: 'var(--bg-secondary-container)' }
                    : {}),
                }}
                title={gc.label}
              >
                {gc.dot != null && (
                  <span
                    className={`block rounded-full ${focused ? 'bg-text-primary' : 'bg-text-secondary'}`}
                    style={{ width: gc.dot, height: gc.dot }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
