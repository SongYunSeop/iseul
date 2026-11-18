// iseul as a standalone Worker. /api/comments is the API, /admin the moderation page (ADMIN_TOKEN),
// and everything else is iseul's browser modules (embed.js, widget.js, ...) for other sites to load.
import { createHandler } from 'iseul/server';

let handler;
const adminPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Comments · admin</title><link rel="stylesheet" href="/widget.css">
<style>:root { color-scheme: light dark; } body { max-width: 860px; margin: 40px auto; padding: 0 16px; font: 16px/1.6 system-ui, sans-serif; background: Canvas; color: CanvasText; }</style>
</head><body><div id="admin"></div><script type="module">import { mountAdmin } from '/admin.js'; mountAdmin('#admin', { lang: navigator.language.startsWith('ko') ? 'ko' : 'en' });</script></body></html>`;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/comments') {
      handler ??= createHandler({
        origins: (env.ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
        webhookContent: env.WEBHOOK_CONTENT === 'true',
      });
      return handler(request, env, ctx);
    }
    if (pathname === '/admin') return new Response(adminPage, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (pathname === '/') return Response.redirect(new URL('/admin', request.url), 302);
    // Module scripts loaded from other sites need CORS.
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  },
};
