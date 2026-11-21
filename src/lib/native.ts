// What changes when the app runs inside the iPhone app instead of a browser. The same code serves
// both; inside the app, the phone's own share sheet, location prompt and haptics take over from
// their web versions, which iOS either lacks (vibration) or asks about twice (location).

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';

export const isNativeApp = Capacitor.isNativePlatform();

/** The live site's price files; the app carries none of its own. */
export const SITE_DATA_URL = 'https://guymaslawi.github.io/sal-hacham/data/';

export async function nativeShare(title: string, text: string) {
  await Share.share({ title, text, dialogTitle: title });
}

export function nativeBuzz(ms: number) {
  void Haptics.impact({ style: ms >= 30 ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
}

export async function nativeLocate(): Promise<{ lat: number; lng: number }> {
  const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/** Leave the launch screen once the first screen has been drawn, so there is never a blank flash. */
export function hideLaunchScreen() {
  requestAnimationFrame(() => requestAnimationFrame(() => void SplashScreen.hide({ fadeOutDuration: 250 })));
}

/** True when the shopper cancelled a share sheet, which is not an error. */
export const isCancel = (err: unknown) => {
  const e = err as { name?: string; message?: string };
  return e?.name === 'AbortError' || /cancel/i.test(e?.message ?? '');
};
