import { useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { cn } from '@myelin/editor/utils';
import { Button } from '@myelin/ui/button';
import bookmarksDemo from '@/assets/whats-new/bookmarks.webp';
import canvasStyleDemo from '@/assets/whats-new/canvas-style.webp';
import pdfAnchoringDemo from '@/assets/whats-new/pdf-anchoring.webp';
import pdfQuoteDemo from '@/assets/whats-new/pdf-quote.webp';
import rotateDemo from '@/assets/whats-new/rotate.webp';
import rulerDemo from '@/assets/whats-new/ruler.webp';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUserPref } from '@/lib/use-user-pref';

// Bump whenever the pages change: anyone who dismissed an older id sees the panel again.
export const WHATS_NEW_RELEASE = 'pdf-quotes-bookmarks';

interface WhatsNewPage {
  title: string;
  description: string;
  /**
   * Looping demo shown above the text; animated WebP, since MP4 may lack a codec on Linux.
   * Encode 896×578 at 30fps with `img2webp -d 33 -near_lossless 60 -q 75 -m 4`: lossy animation
   * (ffmpeg's libwebp_anim or `-mixed`) skips small per-frame changes, so fades leave ghosts behind.
   */
  image?: string;
}

export function WhatsNewDialog() {
  const strings = useMessages();
  const seen = useUserPref('whatsNewSeen');
  const [index, setIndex] = useState(0);
  const pages: WhatsNewPage[] = [
    { ...strings.whatsNew.pdfQuote, image: pdfQuoteDemo },
    { ...strings.whatsNew.pdfAnchoring, image: pdfAnchoringDemo },
    { ...strings.whatsNew.bookmarks, image: bookmarksDemo },
    { ...strings.whatsNew.canvasStyle, image: canvasStyleDemo },
    { ...strings.whatsNew.ruler, image: rulerDemo },
    { ...strings.whatsNew.rotate, image: rotateDemo },
  ];
  const page = pages[index];
  const last = index === pages.length - 1;

  return (
    <Dialog
      open={seen !== WHATS_NEW_RELEASE}
      onOpenChange={(open) => {
        if (!open) {
          UserPrefs.set('whatsNewSeen', WHATS_NEW_RELEASE);
        }
      }}
    >
      <DialogContent className="gap-6 sm:max-w-lg sm:p-8">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {strings.whatsNew.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-32 flex-col gap-2">
          {page.image && (
            <img
              src={page.image}
              alt=""
              className="mb-3 w-full rounded-lg border border-border-subtle"
            />
          )}
          <p className="font-semibold text-base text-text-primary">
            {page.title}
          </p>
          <p className="text-text-secondary">{page.description}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1.5">
            {pages.map((p, i) => (
              <span
                key={p.title}
                className={cn(
                  'size-1.5 rounded-full bg-border-subtle',
                  i === index && 'bg-text-primary',
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="ghost" onClick={() => setIndex(index - 1)}>
                {strings.whatsNew.back}
              </Button>
            )}
            {last ? (
              <DialogClose render={<Button />}>
                {strings.whatsNew.dismiss}
              </DialogClose>
            ) : (
              <Button onClick={() => setIndex(index + 1)}>
                {strings.whatsNew.next}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
