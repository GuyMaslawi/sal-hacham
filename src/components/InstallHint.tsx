import { Share, Smartphone, X } from 'lucide-react';
import { isIos, promptInstall, useInstall } from '../lib/install';
import { useApp } from '../state/app';
import { Button, IconButton } from './ui';

/**
 * Invites the shopper to put the app on the home screen, where it opens full-screen and works
 * without a connection. Under the list it can be dismissed; `always` keeps it on the stores tab.
 */
export function InstallHint({ always = false }: { always?: boolean }) {
  const installed = useInstall((s) => s.installed);
  const canPrompt = useInstall((s) => s.promptEvent !== null);
  const dismissed = useApp((s) => s.installHintDismissed);
  const dismiss = useApp((s) => s.dismissInstallHint);
  const hasItems = useApp((s) => s.items.length > 0);
  const ios = isIos();

  if (installed) return null;
  // Under the list: only once there is something worth coming back to, and until dismissed.
  if (!always && (dismissed || !hasItems)) return null;
  // Desktop browsers without an install prompt have nothing useful to offer here.
  if (!canPrompt && !ios && !always) return null;

  return (
    <section className="relative mx-4 mt-5 rounded-2xl border-[1.5px] border-dashed border-line p-4">
      {!always ? (
        <IconButton label="סגור" onClick={dismiss} className="absolute end-1 top-1 size-9">
          <X className="size-4 text-muted" />
        </IconButton>
      ) : null}
      <h2 className="flex items-center gap-2 font-bold">
        <Smartphone className="size-5" />
        להתקין כאפליקציה בטלפון
      </h2>
      <p className="mt-1 text-sm text-muted">
        האפליקציה נפתחת מהמסך הראשי במסך מלא, והרשימה והמחירים זמינים גם בלי קליטה בסופר.
      </p>
      {canPrompt ? (
        <Button variant="tag" className="mt-3 w-full" onClick={() => void promptInstall()}>
          התקן עכשיו
        </Button>
      ) : ios ? (
        <ol className="mt-3 space-y-1.5 text-sm">
          <li className="flex items-center gap-2">
            <span className="font-bold">1.</span>
            פתח את הדף בספארי ולחץ על כפתור השיתוף <Share className="inline size-4" aria-label="שיתוף" />
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold">2.</span>
            בחר "הוסף למסך הבית"
          </li>
        </ol>
      ) : (
        <p className="mt-2 text-sm">
          בטלפון: פתח את הכתובת הזו בדפדפן, ובתפריט הדפדפן בחר "התקן אפליקציה" או "הוסף למסך הבית".
        </p>
      )}
    </section>
  );
}
