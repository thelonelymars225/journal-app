import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Lists every file in a folder, relative to it (used for the offline cache list).
function walk(dir, root = dir) {
  let out = [];
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      out = statSync(p).isDirectory() ? out.concat(walk(p, root)) : out.concat(relative(root, p).split('\\').join('/'));
    }
  } catch { /* folder missing */ }
  return out;
}

// Writes sw.js with the exact list of built files, so the installed web app
// (and the topic model) works with no connection after the first visit.
function offlineServiceWorker() {
  return {
    name: 'offline-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle), ...walk('public')].filter((f) => f !== 'sw.js');
      const version = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time. Caches the whole app for offline use.
const CACHE = 'journal-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('./'))));
});
`,
      });
    },
  };
}

export default defineConfig({
  // Relative paths so the same build works on GitHub Pages (under /journal-app/) and inside Electron.
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  plugins: [offlineServiceWorker()],
});
