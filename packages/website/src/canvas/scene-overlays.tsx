import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { copy, type PlatformKey, siteLinks } from '@/content/site';
import {
  type DownloadUrls,
  detectPlatform,
  fetchDownloadUrls,
} from '@/lib/downloads';
import { COLLAB_CURSORS, SCENE_PAD, sceneById } from './scenes';
import {
  AudioCardMock,
  LiveCursor,
  SearchPaletteMock,
  WorldLayer,
} from './world-layer';

/** Matches the muted body ink the canvas draws in the same scenes. */
const MUTED = '#59646b';

interface ButtonProps {
  x?: number;
  y?: number;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'outline';
  size?: number;
  children: ReactNode;
  sub?: string;
  /**
   * Fixed world width, with the label centred inside it. Set this when canvas
   * ink has to meet the button: text widths depend on the loaded font, so an
   * arrow can only be aimed at an edge the layout pins down.
   */
  width?: number;
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
  width,
}: ButtonProps) {
  const style: CSSProperties = {
    fontSize: size,
    lineHeight: 1.2,
    padding: `${size * 0.65}px ${size * 1.3}px`,
    // Matches the app button's radius-to-text ratio (rounded-xl on text-sm).
    borderRadius: size * 0.8,
    ...(width != null ? { width } : {}),
    ...(x != null && y != null
      ? { position: 'absolute', left: x, top: y }
      : {}),
    ...(variant === 'primary'
      ? {
          background:
            'linear-gradient(to bottom, var(--primary), var(--bg-primary-container))',
          color: 'var(--primary-foreground)',
        }
      : {
          // --card, not --background: these sit straight on the page, and
          // --background *is* the page colour, so it would not read at all.
          background: 'var(--card)',
          color: 'var(--foreground)',
          // Scaled stand-in for the app's `ring-1 ring-border-ghost`; a real
          // ring would not scale with the canvas.
          boxShadow: `0 0 0 ${size * 0.06}px var(--border-subtle)`,
        }),
  };
  const className = [
    'pointer-events-auto inline-block cursor-pointer whitespace-nowrap no-underline',
    'transition-colors active:translate-y-px',
    variant === 'primary'
      ? 'hover:brightness-110 active:brightness-95'
      : 'hover:bg-hover-tint',
  ].join(' ');
  const inner = (
    <span
      className={`flex flex-col ${width == null ? 'items-start' : 'items-center'}`}
    >
      <span className="font-medium">{children}</span>
      {sub && (
        <span style={{ fontSize: size * 0.65, opacity: 0.7 }}>{sub}</span>
      )}
    </span>
  );
  if (href) {
    return (
      <a
        className={className}
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
    <button type="button" className={className} style={style} onClick={onClick}>
      {inner}
    </button>
  );
}

/**
 * Non-interactive world-space DOM that must render UNDER the ink: mock app
 * surfaces that visitors' strokes (and ours) draw on top of. Sits between
 * the background grid canvas and the foreground element canvas.
 */
export function SceneUnderlay({ canvas }: { canvas: DrawableCanvas }) {
  const audio = sceneById('audio-search').rect;
  const sync = sceneById('sync').rect;

  return (
    <WorldLayer canvas={canvas} zIndex={1}>
      <AudioCardMock x={audio.x + SCENE_PAD} y={audio.y + 470} />
      <SearchPaletteMock x={audio.x + 970} y={audio.y + 470} />
      <LiveCursor
        x={sync.x + COLLAB_CURSORS.you.dx}
        y={sync.y + COLLAB_CURSORS.you.dy}
        color="#3b82f6"
        name={copy.sync.cursorYou}
      />
      <LiveCursor
        x={sync.x + COLLAB_CURSORS.peer.dx}
        y={sync.y + COLLAB_CURSORS.peer.dy}
        color="#ec4899"
        name={copy.sync.cursorPeer}
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
  const [platformKey] = useState<PlatformKey>(detectPlatform);
  // Resolved from the GitHub release, so a button points at the installer
  // itself rather than the releases page. Empty until it lands, and stays empty
  // for platforms the release has no build for.
  const [downloads, setDownloads] = useState<DownloadUrls>({});

  useEffect(() => {
    let cancelled = false;
    void fetchDownloadUrls().then((urls) => {
      if (!cancelled) {
        setDownloads(urls);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadHref = (key: PlatformKey) =>
    downloads[key] ?? siteLinks.releases;

  const hero = sceneById('hero').rect;
  const download = sceneById('download').rect;

  const platforms = copy.download.platforms;
  // Every PlatformKey has an entry, so the fallback is only for the type.
  const primary = platforms.find((p) => p.key === platformKey) ?? platforms[0];
  const others = platforms.filter((p) => p !== primary);

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
        <WorldButton href={downloadHref(primary.key)} size={30}>
          {primary.label}
        </WorldButton>
        <WorldButton variant="outline" size={30} onClick={onSeeItInAction}>
          {copy.hero.ctaSecondary} ↓
        </WorldButton>
      </div>

      {/* Downloads: one big button for the detected OS, the rest as a quiet
          row underneath. Five equal-weight buttons only stacked "Download for"
          five times. */}
      <div
        className="absolute flex flex-col items-start"
        style={{
          left: download.x + SCENE_PAD,
          top: download.y + SCENE_PAD + 280,
        }}
      >
        <WorldButton
          href={downloadHref(primary.key)}
          size={36}
          width={520}
          sub={primary.sub}
        >
          {primary.label}
        </WorldButton>

        <span style={{ fontSize: 22, color: MUTED, marginTop: 64 }}>
          {copy.download.otherPlatforms}
        </span>
        <div className="flex" style={{ gap: 20, marginTop: 20 }}>
          {others.map((platform) => (
            <WorldButton
              key={platform.key}
              href={downloadHref(platform.key)}
              variant="outline"
              size={26}
              sub={platform.sub}
            >
              {platform.name}
            </WorldButton>
          ))}
        </div>

        {/* Kept close to the row it qualifies: it is a caption for the iOS and
            Android chips, not a standalone claim. */}
        <span style={{ fontSize: 21, color: MUTED, marginTop: 36 }}>
          {copy.download.mobileBadge}
        </span>
      </div>

      {/* Footer link row. */}
      <div
        className="absolute flex flex-wrap items-center"
        style={{
          left: download.x + SCENE_PAD,
          top: download.y + SCENE_PAD + 1080,
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
          href={downloadHref(primary.key)}
          target="_blank"
          rel="noreferrer"
        >
          {copy.footer.download}
        </a>
      </div>
    </WorldLayer>
  );
}
