// Removes from the iPhone build what only the website needs: the price files (the app downloads
// them, and they are 300 MB) and the offline service worker (the app is already on the phone).
import { readdirSync, rmSync } from 'node:fs';

const DIR = 'dist-ios';
const webOnly = (name) =>
  name === 'data' || name === 'sw.js' || name === 'manifest.webmanifest' || /^workbox-.*\.js$/.test(name);

for (const name of readdirSync(DIR)) {
  if (webOnly(name)) rmSync(`${DIR}/${name}`, { recursive: true, force: true });
}
console.log(`Trimmed ${DIR} for the iPhone app`);
