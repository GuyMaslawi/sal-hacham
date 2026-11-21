// "Add to home screen". Android offers a prompt we can trigger; on iPhone it is a manual step
// in Safari's share menu, so the best we can do is explain it.

import { create } from 'zustand';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  promptEvent: InstallPromptEvent | null;
  installed: boolean;
}

/**
 * Opened from the Google Play app. Android passes the app as the referrer on the first page
 * only, so remember it for the rest of the visit.
 */
const fromPlayApp = (() => {
  const now = document.referrer.startsWith('android-app://');
  try {
    if (now) sessionStorage.setItem('sal-play-app', '1');
    return now || sessionStorage.getItem('sal-play-app') === '1';
  } catch {
    return now;
  }
})();

const standalone = () =>
  fromPlayApp ||
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const useInstall = create<InstallState>()(() => ({ promptEvent: null, installed: standalone() }));

// The browser fires this once, early, so listen from the moment the app loads.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  useInstall.setState({ promptEvent: event as InstallPromptEvent });
});
window.addEventListener('appinstalled', () => useInstall.setState({ promptEvent: null, installed: true }));

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  const { promptEvent } = useInstall.getState();
  if (!promptEvent) return;
  await promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  useInstall.setState({ promptEvent: null, installed: outcome === 'accepted' });
}
