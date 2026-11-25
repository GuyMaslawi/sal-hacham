import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './lib/install';
import { isPickingPhoto } from './lib/listInput';
import { hideLaunchScreen, isNativeApp } from './lib/native';
import { useNav } from './state/nav';

// On the web: a new version is installed quietly and takes over the next time the app is put
// away, never while someone is in the middle of a search or a shopping trip. The iPhone app
// carries its own files and is updated through the App Store instead.
if (!isNativeApp) {
  let updateReady = false;
  const applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true;
    },
  });
  // Reloading wipes whatever is half done, so only when the app is resting on the list: not
  // while a sheet is open (a list being typed, the shopper off copying more from WhatsApp), not
  // in the store, and not while the camera or photo picker is up on top of it.
  const resting = () => {
    const { tab, stack } = useNav.getState();
    return tab === 'list' && stack.length === 0 && !isPickingPhoto();
  };
  document.addEventListener('visibilitychange', () => {
    if (updateReady && document.visibilityState === 'hidden' && resting()) void applyUpdate(true);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if (isNativeApp) hideLaunchScreen();
