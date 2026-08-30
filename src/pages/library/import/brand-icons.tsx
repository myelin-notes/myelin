/**
 * Brand marks for import sources, used unmodified from each vendor's official
 * assets. Every one of them forbids recolouring, so nothing here is tinted.
 *
 * The files under `./brand/` are stored byte for byte as downloaded, under the
 * vendor's own filename, and rendered through <img> rather than inlined: an
 * <img> cannot inherit the picker tile's `text-*` colour the way an inline
 * <svg> would, and it keeps their generic gradient ids (OneNote ships `id="a"`)
 * out of the app's DOM. Re-download to update, and never hand-edit.
 *
 * All three read on the light and the dark theme. Goodnotes is the one to know
 * about: its icon carries an opaque white backplate (transparent corners, white
 * centre), so on the dark theme it shows as a white chip rather than a bare
 * glyph like the other two. That is the vendor's app-icon form, not a bug. The
 * press kit's mono pair is the bare-glyph alternative if that ever reads wrong.
 *
 * Sources: the standalone icon on goodnotes.com; the Office brand-icon CDN for
 * OneNote; the SVGs linked from obsidian.md/brand.
 */
import goodnotesMark from './brand/goodnotes-icon-256.png';
import obsidianMark from './brand/obsidian-logo-gradient.svg';
import oneNoteMark from './brand/onenote_48x1.svg';

interface BrandIconProps {
  className?: string;
}

function brandMark(src: string) {
  return function BrandMark({ className }: BrandIconProps) {
    return <img src={src} alt="" aria-hidden="true" className={className} />;
  };
}

export const GoodnotesIcon = brandMark(goodnotesMark);
export const OneNoteIcon = brandMark(oneNoteMark);
export const ObsidianIcon = brandMark(obsidianMark);
