/* =====================================================================
   OpenCode Zen CORS proxy — Cloudflare Worker
   Forwards /<path> to https://opencode.ai/<path> and adds CORS headers
   so the Termux Web static site (GitHub Pages) can call the Zen API.

   Deploy: Cloudflare dashboard -> Workers -> Create Worker -> paste
   this code -> Save & deploy. Then in Termux Web:
     opencode proxy https://<tu-worker>.workers.dev/zen/v1
   ===================================================================== */
'use strict';

const UPSTREAM = 'https://opencode.ai';
const ALLOW_ORIGIN = 'https://fivetechsoft.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete('Origin');
    headers.delete('Referer');
    headers.delete('Host');

    const resp = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body
    });

    const respHeaders = new Headers(resp.headers);
    const cors = corsHeaders();
    for (const k in cors) respHeaders.set(k, cors[k]);

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders
    });
  }
};
