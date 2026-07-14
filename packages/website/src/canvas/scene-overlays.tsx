import { type CSSProperties, type ReactNode, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { copy, siteLinks } from '@/content/site';
import { SCENE_PAD, sceneById } from './scenes';
import { Placeholder, WorldLayer } from './world-layer';

type OS = 'mac' | 'windows' | 'linux';

function detectOS(): OS {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(ua)) {
    return 'mac';
  }
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    return 'linux';
  }
  return 'windows';
}

const OS_LABELS: Record<OS, string> = {
  mac: 'Download for macOS',
  windows: 'Download for Windows',
  linux: 'Download for Linux',
};

interface ButtonProps {
  x?: number;
  y?: number;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'outline';
  size?: number;
  children: ReactNode;
  sub?: string;
}

/**
 * A button living in world coordinates. Sized in world units so it scales
 * with the canvas like every other element in a scene.
 */
function WorldButton({
  x,
  y,
  href,
  onClick,
  variant = 'primary',
  size = 26,
  children,
  sub,
}: ButtonProps) {
  const style: CSSProperties = {
    fontSize: size,
    lineHeight: 1.2,
    padding: `${size * 0.65}px ${size * 1.3}px`,
    borderRadius: size * 0.55,
    ...(x != null && y != null
      ? { position: 'absolute', left: x, top: y }
      : {}),
    ...(variant === 'primary'
      ? { background: '#1a1a1a', color: '#ffffff' }
      : {
          background: 'rgba(255, 255, 255, 0.75)',
          color: '#1a1a1a',
          border: '2px solid rgba(26, 26, 26, 0.7)',
        }),
  };
  const inner = (
    <span className="flex flex-col items-start">
      <span className="font-semibold">{children}</span>
      {sub && (
        <span style={{ fontSize: size * 0.65, opacity: 0.7 }}>{sub}</span>
      )}
    </span>
  );
  if (href) {
    return (
      <a
        className="pointer-events-auto inline-block cursor-pointer whitespace-nowrap no-underline transition-transform hover:scale-[1.03]"
        style={style}
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="pointer-events-auto inline-block cursor-pointer whitespace-nowrap transition-transform hover:scale-[1.03]"
      style={style}
      onClick={onClick}
    >
      {inner}
    </button>
  );
}

/**
 * Non-interactive world-space DOM that must render UNDER the ink: screenshot
 * placeholders that visitors' strokes (and ours) draw on top of. Sits between
 * the background grid canvas and the foreground element canvas.
 */
export function SceneUnderlay({ canvas }: { canvas: DrawableCanvas }) {
  const pdf = sceneById('pdf').rect;
  const audio = sceneById('audio-search').rect;

  return (
    <WorldLayer canvas={canvas} zIndex={1}>
      <Placeholder
        x={pdf.x + 930}
        y={pdf.y + 120}
        width={780}
        height={860}
        label={copy.pdf.placeholder}
      />
      <Placeholder
        x={audio.x + SCENE_PAD}
        y={audio.y + 470}
        width={700}
        height={420}
        label={copy.audioSearch.audioPlaceholder}
      />
      <Placeholder
        x={audio.x + 970}
        y={audio.y + 470}
        width={760}
        height={420}
        label={copy.audioSearch.searchPlaceholder}
      />
    </WorldLayer>
  );
}

interface SceneOverlayProps {
  canvas: DrawableCanvas;
  onSeeItInAction: () => void;
}

/**
 * Interactive world-space DOM: every CTA, download button, and external link
 * from the content plan, anchored inside its scene. Coordinates mirror the
 * layout constants in `scenes.ts` (same SCENE_PAD inset).
 */
export function SceneOverlay({ canvas, onSeeItInAction }: SceneOverlayProps) {
  const [os] = useState<OS>(detectOS);

  const hero = sceneById('hero').rect;
  const localFirst = sceneById('local-first').rect;
  const supporter = sceneById('supporter').rect;
  const roadmap = sceneById('roadmap').rect;
  const download = sceneById('download').rect;

  return (
    <WorldLayer canvas={canvas} zIndex={30}>
      {/* Hero CTAs, between the subheadline and the trust line. */}
      <div
        className="absolute flex items-center"
        style={{
          left: hero.x + SCENE_PAD,
          top: hero.y + SCENE_PAD + 560,
          gap: 28,
        }}
      >
        <WorldButton href={siteLinks.releases} size={30}>
          {OS_LABELS[os]}
        </WorldButton>
        <WorldButton variant="outline" size={30} onClick={onSeeItInAction}>
          {copy.hero.ctaSecondary} ↓
        </WorldButton>
      </div>

      {/* Local-first: source link. */}
      <WorldButton
        x={localFirst.x + SCENE_PAD}
        y={localFirst.y + SCENE_PAD + 950}
        href={siteLinks.github}
        variant="outline"
      >
        {copy.localFirst.cta}
      </WorldButton>

      {/* Founding Supporter CTAs. */}
      <div
        className="absolute flex items-center"
        style={{
          left: supporter.x + SCENE_PAD,
          top: supporter.y + SCENE_PAD + 880,
          gap: 24,
        }}
      >
        <WorldButton href={siteLinks.sponsors} size={28}>
          {copy.supporter.ctaPrimary}
        </WorldButton>
        <WorldButton href={siteLinks.kofi} variant="outline" size={28}>
          {copy.supporter.ctaSecondary}
        </WorldButton>
      </div>

      {/* Roadmap link. */}
      <WorldButton
        x={roadmap.x + SCENE_PAD}
        y={roadmap.y + SCENE_PAD + 940}
        href={siteLinks.roadmap}
        variant="outline"
      >
        {copy.roadmap.cta}
      </WorldButton>

      {/* Download buttons, one per platform, detected OS first. */}
      <div
        className="absolute flex flex-col items-start"
        style={{
          left: download.x + SCENE_PAD,
          top: download.y + SCENE_PAD + 280,
          gap: 22,
        }}
      >
        {[...copy.download.platforms]
          .sort((a, b) => (a.key === os ? -1 : b.key === os ? 1 : 0))
          .map((platform, i) => (
            <WorldButton
              key={platform.key}
              href={siteLinks.releases}
              variant={i === 0 ? 'primary' : 'outline'}
              size={28}
              sub={platform.sub}
            >
              {platform.label}
            </WorldButton>
          ))}
        <span
          className="rounded-full"
          style={{
            fontSize: 20,
            padding: '8px 20px',
            background: 'rgba(249, 115, 22, 0.12)',
            color: '#c2570b',
            border: '1px solid rgba(249, 115, 22, 0.4)',
          }}
        >
          {copy.download.ipadBadge}
        </span>
      </div>

      {/* Footer link row. */}
      <div
        className="absolute flex flex-wrap items-center"
        style={{
          left: download.x + SCENE_PAD,
          top: download.y + SCENE_PAD + 1130,
          gap: 34,
          fontSize: 22,
        }}
      >
        {copy.footer.links.map((link) => (
          <a
            key={link.label}
            className="pointer-events-auto underline underline-offset-4"
            style={{ color: '#374151' }}
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        ))}
        <a
          className="pointer-events-auto font-semibold underline underline-offset-4"
          style={{ color: '#1a1a1a' }}
          href={siteLinks.releases}
          target="_blank"
          rel="noreferrer"
        >
          {copy.footer.download}
        </a>
      </div>
    </WorldLayer>
  );
}
