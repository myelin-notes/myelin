import { useMessages } from '@myelin/editor/i18n';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUserPref } from '@/lib/use-user-pref';

// Bump whenever `whatsNew.items` changes: anyone who dismissed an older id sees the panel again.
export const WHATS_NEW_RELEASE = 'native-sync';

export function WhatsNewDialog() {
  const strings = useMessages();
  const seen = useUserPref('whatsNewSeen');

  return (
    <Dialog
      open={seen !== WHATS_NEW_RELEASE}
      onOpenChange={(open) => {
        if (!open) {
          UserPrefs.set('whatsNewSeen', WHATS_NEW_RELEASE);
        }
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {strings.whatsNew.title}
          </DialogTitle>
        </DialogHeader>

        <ul className="flex flex-col gap-4">
          {strings.whatsNew.items.map((item) => (
            <li key={item.title} className="flex flex-col gap-1">
              <p className="font-semibold text-text-primary">{item.title}</p>
              <p className="text-text-secondary">{item.description}</p>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <DialogClose render={<Button />}>
            {strings.whatsNew.dismiss}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
