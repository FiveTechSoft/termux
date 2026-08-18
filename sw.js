/* Service Worker — CORS proxy for AI API */
'use strict';

const PROXY_ORIGINS = ['https://opencode.ai'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isProxied = PROXY_ORIGINS.some(o => url.origin === o);

  if (!isProxied) return;

  event.respondWith(
    (async () => {
      const headers = new Headers(event.request.headers);
      const init = {
        method: event.request.method,
        headers,
        mode: 'cors',
        credentials: 'omit'
      };

      if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
        init.body = await event.request.text();
      }

      const resp = await fetch(url.href, init);
      const respHeaders = new Headers(resp.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.delete('X-Frame-Options');

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders
      });
    })()
  );
});
