// LCI-SFM Multi-Page Operations Console Bootstrap
import { applyTheme, store } from './store.js';
import { createRouter } from './router.js';

export function mountLciPlatform() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const rootEl = document.getElementById('app-root');
  if (!rootEl) return null;

  applyTheme(store.theme);
  const router = createRouter(rootEl);
  router.start();
  return router;
}
