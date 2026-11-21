import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './lib/install';
import { hideLaunchScreen, isNativeApp } from './lib/native';

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
  document.addEventListener('visibilitychange', () => {
    if (updateReady && document.visibilityState === 'hidden') void applyUpdate(true);
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
