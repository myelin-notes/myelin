import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import type { SvgIcon } from "@/pages/free-canvas/tools/tool";

const CENTER_ZONE = 40;

export interface WheelItem {
  label: string;
  icon: SvgIcon;
  command?: () => void;
}

export interface WheelPickerHandle {
  show: (event: PointerEvent) => void;
  hide: () => void;
}

interface WheelPickerProps {
  radius: number;
  items: WheelItem[];
  children?: React.ReactNode;
  onCenterClicked?: () => void;
}

export const WheelPicker = forwardRef<WheelPickerHandle, WheelPickerProps>(
  ({ radius, items, children, onCenterClicked }, ref) => {
    const groupRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const centerPosRef = useRef([0, 0]);

    const delta = (2 * Math.PI) / items.length;

    const positions: [number, number][] = [];
    let theta = 0;
    for (let i = 0; i < items.length; i++) {
      const x = radius * Math.cos(theta);
      const y = radius * Math.sin(theta);
      positions[i] = [x, y];
      theta += delta;
    }

    const show = useCallback((event: PointerEvent) => {
      if (groupRef.current) {
        groupRef.current.style.left = `${event.clientX}px`;
        groupRef.current.style.top = `${event.clientY}px`;
      }
      setVisible(true);
      centerPosRef.current = [event.clientX, event.clientY];
    }, []);

    const hide = useCallback(() => {
      setVisible(false);
    }, []);

    useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

    function clamp(input: number, min: number, max: number): number {
      return input < min ? min : input > max ? max : input;
    }

    function map(current: number, in_min: number, in_max: number, out_min: number, out_max: number): number {
      const mapped = ((current - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
      return clamp(mapped, out_min, out_max);
    }

    useEffect(() => {
      const handlePointerUp = (evt: PointerEvent) => {
        if (evt.pointerType !== "mouse") return;
        const active = document.activeElement;
        if (active != null && (active.classList.contains("menu-btn") || active.classList.contains("center"))) {
          (active as HTMLButtonElement).click();
        }
        setVisible(false);
      };

      const handlePointerMove = (evt: PointerEvent) => {
        if (!groupRef.current) return;
        const container = groupRef.current.querySelector('[data-wheel-container]');
        if (!container) return;

        const dx = evt.clientX - centerPosRef.current[0];
        const dy = evt.clientY - centerPosRef.current[1];

        if (Math.sqrt(dx * dx + dy * dy) < CENTER_ZONE) {
          const center = container.querySelector(".center");
          if (center) (center as HTMLElement).focus();
          return;
        }

        let t = map(Math.atan2(-dy, -dx), -Math.PI, Math.PI, 0, Math.PI * 2);
        t += delta * 0.5;
        if (t > Math.PI * 2) t -= Math.PI * 2;

        const i = clamp(Math.floor(t / delta), 0, items.length - 1);
        const elements = container.querySelectorAll(".menu-btn");
        if (elements[i]) {
          (elements[i] as HTMLElement).focus();
        }
      };

      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointermove", handlePointerMove);

      return () => {
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointermove", handlePointerMove);
      };
    }, [delta, items.length]);

    return (
      <div ref={groupRef} className="absolute left-0 top-0" onContextMenu={e => e.preventDefault()}>
        {visible && (
          <div data-wheel-container className="relative left-0 top-0 animate-in fade-in duration-150">
            <button
              className="center absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full aspect-square p-3 bg-secondary focus:bg-primary border-none outline-none cursor-pointer"
              onClick={onCenterClicked}
            >
              {children}
            </button>

            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={index}
                  className="menu-btn absolute -translate-x-1/2 -translate-y-1/2 rounded-full aspect-square p-3 bg-secondary focus:bg-primary border-none outline-none cursor-pointer"
                  style={{ left: `${positions[index][0]}px`, top: `${positions[index][1]}px` }}
                  title={item.label}
                  onClick={item.command}
                >
                  <Icon className="text-icons" width="1.2em" height="1.2em" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
);
