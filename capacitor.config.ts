// The iPhone app: the same web app, bundled inside a native shell so it opens instantly and works
// without a connection. Price files still come from the live site every day.
//
//   npm run ios        build the web app for the phone and copy it into ios/
//   npx cap open ios   open the project in Xcode

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.guymaslawi.salhacham',
  appName: 'סל חכם',
  // A separate build: the phone must not carry the site's 300 MB of price files.
  webDir: 'dist-ios',
  ios: {
    // The web app already keeps clear of the notch and home bar (env(safe-area-inset-*)).
    contentInset: 'never',
    backgroundColor: '#eceff1',
    // Links to the site's pages open in the browser rather than inside the app.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // Shrink the app above the keyboard, so sheets with a text box (paste a list, search) stay
    // visible while typing instead of hiding behind it.
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      // Stay on the yellow launch screen until the first screen of the app has been drawn.
      launchAutoHide: false,
      backgroundColor: '#ffd60a',
      showSpinner: false,
    },
  },
};

export default config;
