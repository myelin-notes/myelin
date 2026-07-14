import { type ReactNode, useEffect, useRef } from 'react';
import {
  MousePointer2 as CursorIcon,
  FileText as FileTextIcon,
  Mic as MicIcon,
  PenLine as PenLineIcon,
  Search as SearchIcon,
} from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { copy } from '@/content/site';

interface WorldLayerProps {
  canvas: DrawableCanvas;
  zIndex: number;
  children: ReactNode;
}

/**
 * DOM plane locked to the canvas's world coordinates: children positioned with
 * absolute `left`/`top` in world units ride along with every pan, zoom, and
 * camera animation. This is how the site adds interactive HTML (buttons,
 * links, mock app surfaces) "on the canvas" without inventing a new
 * persisted element type in the engine.
 *
 * The container ignores pointer events; interactive children opt back in with
 * `pointer-events-auto`.
 */
export function WorldLayer({ canvas, zIndex, children }: WorldLayerProps) {
  const planeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const plane = planeRef.current;
    if (!plane) {
      return;
    }
    const apply = () => {
      const { offset, zoom } = canvas.viewport;
      plane.style.transform = `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`;
    };
    apply();
    return canvas.viewport.onViewChange(apply);
  }, [canvas]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex }}
    >
      {/* The plane needs a real size: absolutely-positioned children resolve
          their shrink-to-fit width against it, and a zero-sized plane would
          collapse them to min-content (one word per line). */}
      <div
        ref={planeRef}
        className="absolute top-0 left-0"
        style={{ transformOrigin: '0 0', width: 1_000_000, height: 1_000_000 }}
      >
        {children}
      </div>
    </div>
  );
}

interface WorldPos {
  x: number;
  y: number;
}

/**
 * The mock app surfaces below stand in for real screenshots until those are
 * captured. They render UNDER the ink layer, so the scenes' annotations
 * (highlights, circles, hand notes) draw on top of them like real markup.
 */

const CARD_SHADOW =
  '0 1px 2px rgba(25, 28, 30, 0.05), 0 12px 32px -12px rgba(25, 28, 30, 0.18)';

/** Gray skeleton text bar, the body filler of the mock PDF page. */
function Bar({
  x,
  y,
  w,
  h = 12,
  tone = 'rgba(25, 28, 30, 0.14)',
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  tone?: string;
}) {
  return (
    <span
      className="absolute rounded-full"
      style={{ left: x, top: y, width: w, height: h, background: tone }}
    />
  );
}

const PARAGRAPH = [668, 640, 668, 612] as const;

/** A paper page with skeleton text, sized so the scene's ink annotations
 * (pink circle, highlighter swipe, underline) land on its "sentences". */
export function PdfPageMock({ x, y }: WorldPos) {
  const dark = 'rgba(25, 28, 30, 0.72)';
  return (
    <div
      className="absolute rounded-md bg-white"
      style={{
        left: x,
        top: y,
        width: 780,
        height: 860,
        boxShadow: CARD_SHADOW,
      }}
    >
      <Bar x={56} y={64} w={420} h={26} tone={dark} />
      <Bar x={56} y={112} w={250} h={12} tone="rgba(25, 28, 30, 0.22)" />

      {PARAGRAPH.map((w, i) => (
        <Bar key={`p1-${i}`} x={56} y={170 + i * 26} w={w} />
      ))}

      {/* Centered display-equation bars: the pink ink circle rings these. */}
      <Bar x={230} y={296} w={320} h={14} tone="rgba(25, 28, 30, 0.3)" />
      <Bar x={270} y={324} w={240} h={12} tone="rgba(25, 28, 30, 0.2)" />

      {[668, 655, 668, 620, 440].map((w, i) => (
        <Bar key={`p2-${i}`} x={56} y={396 + i * 26} w={w} />
      ))}

      {[668, 648, 400].map((w, i) => (
        <Bar key={`p3-${i}`} x={56} y={556 + i * 26} w={w} />
      ))}

      {PARAGRAPH.map((w, i) => (
        <Bar key={`p4-${i}`} x={56} y={668 + i * 26} w={w * 0.96} />
      ))}

      <Bar x={374} y={812} w={32} h={10} tone="rgba(25, 28, 30, 0.22)" />
    </div>
  );
}

/** Deterministic waveform bar heights (no Math.random: SSR + resume safe). */
const WAVE_HEIGHTS = Array.from({ length: 46 }, (_, i) => {
  const t = i / 45;
  return Math.round(
    14 + 34 * Math.abs(Math.sin(t * 9.2) * (0.55 + 0.45 * Math.sin(t * 3.1))),
  );
});

export function AudioCardMock({ x, y }: WorldPos) {
  const mock = copy.audioSearch.audioMock;
  const [pre, post] = mock.transcript.split(mock.match);
  return (
    <div
      className="absolute rounded-2xl border border-neutral-200 bg-white"
      style={{
        left: x,
        top: y,
        width: 700,
        height: 420,
        boxShadow: CARD_SHADOW,
      }}
    >
      <div className="flex items-center gap-4 px-8 pt-7">
        <span className="size-3.5 rounded-full bg-[#e03e3e]" />
        <span
          className="font-semibold text-neutral-800"
          style={{ fontSize: 22 }}
        >
          {mock.title}
        </span>
        <span
          className="ml-auto text-neutral-400 tabular-nums"
          style={{ fontSize: 20 }}
        >
          {mock.duration}
        </span>
      </div>

      <div
        className="flex items-center gap-[6px] px-8"
        style={{ height: 120, marginTop: 24 }}
      >
        {WAVE_HEIGHTS.map((h, i) => (
          <span
            key={i}
            className="w-[8px] rounded-full"
            style={{
              height: h,
              background: i < 30 ? '#3b82f6' : 'rgba(25, 28, 30, 0.15)',
            }}
          />
        ))}
      </div>

      <div className="px-8" style={{ marginTop: 24 }}>
        <div
          className="font-semibold text-neutral-400 uppercase tracking-widest"
          style={{ fontSize: 14 }}
        >
          {mock.transcriptLabel}
        </div>
        <p
          className="text-neutral-600"
          style={{ fontSize: 20, lineHeight: 1.5, marginTop: 10 }}
        >
          {pre}
          <span className="rounded-sm bg-[rgba(250,204,21,0.4)] px-1">
            {mock.match}
          </span>
          {post}
        </p>
      </div>
    </div>
  );
}

const RESULT_ICONS = {
  page: FileTextIcon,
  ink: PenLineIcon,
  audio: MicIcon,
} as const;

export function SearchPaletteMock({ x, y }: WorldPos) {
  const mock = copy.audioSearch.searchMock;
  return (
    <div
      className="absolute overflow-hidden rounded-2xl border border-neutral-200 bg-white"
      style={{
        left: x,
        top: y,
        width: 760,
        height: 420,
        boxShadow: CARD_SHADOW,
      }}
    >
      <div className="flex items-center gap-4 border-neutral-200 border-b px-8 py-6">
        <SearchIcon
          className="text-neutral-400"
          style={{ width: 24, height: 24 }}
        />
        <span className="text-neutral-800" style={{ fontSize: 22 }}>
          {mock.query}
        </span>
        <span className="ml-px h-6 w-px animate-pulse bg-neutral-500" />
        <kbd
          className="ml-auto rounded-md border border-neutral-200 px-2 py-1 text-neutral-400"
          style={{ fontSize: 14 }}
        >
          esc
        </kbd>
      </div>
      <div className="p-3">
        {mock.results.map((result, i) => {
          const Icon = RESULT_ICONS[result.kind];
          return (
            <div
              key={result.title}
              className={`flex items-center gap-5 rounded-xl px-5 py-4 ${
                i === 0 ? 'bg-neutral-100' : ''
              }`}
            >
              <Icon
                className="shrink-0 text-neutral-500"
                style={{ width: 24, height: 24 }}
              />
              <div className="min-w-0">
                <div
                  className="truncate font-medium text-neutral-800"
                  style={{ fontSize: 20 }}
                >
                  {result.title}
                </div>
                <div
                  className="truncate text-neutral-500"
                  style={{ fontSize: 17, marginTop: 2 }}
                >
                  {result.snippet}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Figma-style live cursor with a name tag, for the collab scene. */
export function LiveCursor({
  x,
  y,
  color,
  name,
}: WorldPos & { color: string; name: string }) {
  return (
    <div className="absolute" style={{ left: x, top: y, color }}>
      <CursorIcon
        fill="currentColor"
        strokeWidth={1}
        style={{ width: 34, height: 34 }}
      />
      <span
        className="absolute rounded-full px-3 py-1 font-medium text-white"
        style={{ left: 24, top: 30, fontSize: 19, background: color }}
      >
        {name}
      </span>
    </div>
  );
}
