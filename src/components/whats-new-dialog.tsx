import { useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { cn } from '@myelin/editor/utils';
import { Button } from '@myelin/ui/button';
import anchoringDemo from '@/assets/whats-new/anchoring.webp';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUserPref } from '@/lib/use-user-pref';

// Bump whenever the pages change: anyone who dismissed an older id sees the panel again.
export const WHATS_NEW_RELEASE = 'native-sync';

interface WhatsNewPage {
  title: string;
  description: string;
  /**
   * Looping demo shown above the text; animated WebP, since MP4 may lack a codec on Linux.
   * Encode with `img2webp -mixed -q 90`: ffmpeg's lossy libwebp_anim leaves ghosting behind motion.
   */
  image?: string;
}

export function WhatsNewDialog() {
  const strings = useMessages();
  const seen = useUserPref('whatsNewSeen');
  const [index, setIndex] = useState(0);
  const pages: WhatsNewPage[] = [
    strings.whatsNew.sync,
    { ...strings.whatsNew.anchoring, image: anchoringDemo },
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
