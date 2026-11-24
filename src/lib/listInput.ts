// The ways to add a whole list at once. Each starts on the shopper's tap, because browsers let a
// page open the photo picker or read the clipboard only in direct response to one.

import { useNav, type ListStart } from '../state/nav';

let picker: HTMLInputElement | null = null;

/**
 * Open the phone's picker for a photo or a screenshot of a list. No `capture` attribute, so the
 * phone offers both the camera and the gallery (a screenshot of a WhatsApp list is common).
 * `onPicked` gets the chosen picture; nothing happens if the shopper cancels.
 */
export function pickPhoto(onPicked: (photo: Blob) => void) {
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.hidden = true;
    document.body.append(picker);
  }
  const input = picker;
  input.value = '';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPicked(file);
  };
  input.click();
}

/** Ask for what was copied, if the browser allows it; resolves to '' when it does not. */
export function readClipboard(): Promise<string> {
  if (typeof navigator.clipboard?.readText !== 'function') return Promise.resolve('');
  return navigator.clipboard.readText().catch(() => '');
}

/** Start adding a list the way the shopper chose, from a button on the list screen. */
export function startList(start: ListStart) {
  const open = useNav.getState().open;
  if (start === 'photo') pickPhoto((photo) => open({ kind: 'addList', start, photo }));
  else if (start === 'paste') open({ kind: 'addList', start, clipboard: readClipboard() });
  else open({ kind: 'addList', start });
}
