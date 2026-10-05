import type { ComponentType, CSSProperties } from 'react';
import type { ImportSourceId } from '@/content/site';

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Vendor marks served from `public/brand/`, stored byte for byte as downloaded
 * under the vendor's own filename, and referenced rather than inlined. Every
 * one of these vendors forbids recoloring, and an <img> cannot inherit a tint
 * the way an inline <svg> would; it also keeps their generic gradient ids
 * (OneNote ships `id="a"`) out of the page. Re-download to update, never
 * hand-edit, and never substitute a third-party flattened or recolored
 * version.
 *
 * Goodnotes: the standalone icon on goodnotes.com. Their own SVGs are the
 *   horizontal lockup, which would repeat the name printed beside it, and
 *   cropping the mark out of a lockup is exactly the reconfiguring their
 *   rules forbid. 256px covers 40 world units at the canvas's 3x zoom cap.
 * Obsidian: the SVGs linked from obsidian.md/brand.
 * OneNote: the Office brand-icon CDN, res-1.cdn.office.net/files/fabric.
 * Notion: the app icon on notion.com. Their guidelines let an integration
 *   show compatibility with an unmodified asset kept secondary to our own
 *   branding, which is what this row is. Monochrome is their mark, not a
 *   tint we applied.
 */
function brandMark(src: string) {
  return function BrandMark({ className, style }: IconProps) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={className}
        style={style}
      />
    );
  };
}

const GoodnotesIcon = brandMark('/brand/goodnotes-icon-256.png');
const NotionIcon = brandMark('/brand/notion-logo-ios.png');
const ObsidianIcon = brandMark('/brand/obsidian-logo-gradient.svg');
const OneNoteIcon = brandMark('/brand/onenote_48x1.svg');

/** Every source shows its real mark; see the notes on each for the source. */
export const IMPORT_SOURCE_ICONS: Record<
  ImportSourceId,
  ComponentType<IconProps>
> = {
  goodnotes: GoodnotesIcon,
  onenote: OneNoteIcon,
  obsidian: ObsidianIcon,
  notion: NotionIcon,
};
