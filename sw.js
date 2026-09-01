/* Service Worker — CORS proxy for AI API + Termux repos */
'use strict';

const PROXY_ORIGINS = [
  'https://opencode.ai',
  'https://api.groq.com',
  'https://api.x.ai'
];

/* packages.termux.dev has no CORS headers — route through a proxy */
const CORS_PROXY = 'https://corsproxy.io/';
const TERMUX_ORIGIN = 'https://packages.termux.dev';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isProxied = PROXY_ORIGINS.some(o => url.origin === o);
  const isTermuxRepo = url.origin === TERMUX_ORIGIN;

  if (!isProxied && !isTermuxRepo) return;

  event.respondWith((async () => {
    if (event.request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Api-Key',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    /* --- Termux repo: route through CORS proxy --- */
    if (isTermuxRepo) {
      const proxyUrl = CORS_PROXY + encodeURIComponent(url.href);
      try {
        const resp = await fetch(proxyUrl);
        if (!resp.ok) throw new Error('Proxy HTTP ' + resp.status);
        const body = await resp.arrayBuffer();
        const respHeaders = new Headers(resp.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.delete('X-Frame-Options');
        return new Response(body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: respHeaders
        });
      } catch (e) {
        return new Response('Proxy fetch failed: ' + e.message, {
          status: 502,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }
        });
      }
    }

    /* --- AI API origins: direct pass-through --- */
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
    const respHeaders = new Response(resp.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    respHeaders.delete('X-Frame-Options');
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders
    });
  })());
});
