// Things the shopper does to the list that deserve a safety net or a system dialog.

import { toast } from '../components/ui';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

/** Remove a line, with a few seconds to change your mind. */
export function removeWithUndo(itemId: string) {
  const { items, removeItem, restoreItems } = useApp.getState();
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) return;
  const item = items[index];
  removeItem(itemId);
  toast('הוסר מהרשימה', { label: 'בטל', run: () => restoreItems([{ item, index }]) });
}

/** Stepping a quantity down to zero removes the line. */
export function changeQty(itemId: string, qty: number) {
  if (qty <= 0) removeWithUndo(itemId);
  else useApp.getState().setQty(itemId, qty);
}

export function clearListWithUndo() {
  const { items, clearAll, restoreItems } = useApp.getState();
  if (!items.length) return;
  const entries = items.map((item, index) => ({ item, index }));
  clearAll();
  toast('הרשימה נוקתה', { label: 'בטל', run: () => restoreItems(entries) });
}

/** Send the list as plain text (WhatsApp, Messages), one product per line. */
export async function shareList() {
  const { items } = useApp.getState();
  const text = items.map((i) => (i.qty !== 1 ? `${i.qty} ${i.label}` : i.label)).join('\n');
  if (!text) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'רשימת קניות', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('הרשימה הועתקה. אפשר להדביק אותה בכל מקום');
  } catch (err) {
    // Closing the share sheet is not an error.
    if ((err as Error).name !== 'AbortError') toast('השיתוף לא הצליח');
  }
}

/**
 * End a shopping trip: what went into the cart leaves the list, what did not stays for next
 * time, and the shopper is taken back to the list. Can be undone for a few seconds.
 */
export function finishShopping() {
  const { items, clearChecked, restoreItems } = useApp.getState();
  const bought = items.map((item, index) => ({ item, index })).filter((e) => e.item.checked);
  const left = items.length - bought.length;
  clearChecked();
  useNav.getState().go('list');
  toast(
    left > 0
      ? `הקנייה הסתיימה. ${left === 1 ? 'מוצר אחד נשאר' : `${left} מוצרים נשארו`} ברשימה לפעם הבאה`
      : 'הקנייה הסתיימה. הרשימה ריקה ומוכנה לפעם הבאה',
    bought.length ? { label: 'בטל', run: () => restoreItems(bought) } : undefined,
  );
}
