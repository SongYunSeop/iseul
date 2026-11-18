# iseul

Login-free comments that fade. Each commenter picks how long their comment stays on the page: a day, a week, a month, a year, or forever. Runs on Cloudflare Workers or Pages Functions with D1 and Turnstile, within the free tier.

[Demo](https://songyunseop.github.io/iseul/) · [한국어](README.ko.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SongYunSeop/iseul/tree/main/template)

`iseul` (이슬) is Korean for "dew": it settles for a while, then is gone.

## Features

- **Comments that fade.** When a comment's time is up it leaves the page. Replies never outlast the comment they answer.
- **No accounts.** A name is optional. A password set when posting lets the author edit or delete later; only a salted PBKDF2 hash is stored.
- **Little data, kept for you.** No IP, no email, no tracking. Expired and deleted comments leave the page but stay in your database for moderation.
- **Private comments.** Optionally, a commenter can make a comment visible to the site admin only; the page shows a placeholder.
- **Replies and reactions.** One level of replies, emoji reactions (👍 ❤️ 😂 😮 😢 by default, or your own set), and author replies with a badge.
- **Moderation page.** Filter by page and state, search, delete in bulk, reply as the author, export JSON or CSV.
- **Notifications.** An optional webhook for Slack, Discord, or anything else.
- **Small.** No dependencies. The widget is about 8 KB gzipped, in Korean or English.

Five entry points: `iseul/server` (API handler), `iseul/client` (fetch wrapper for your own UI), `iseul/widget` (ready-made comments UI), `iseul/admin` (moderation page), and `iseul/embed` (script tag for pages without a bundler).

## Deploy to Cloudflare

The button above deploys [`template/`](template): one Worker with the API, the moderation page at `/admin`, and `embed.js` for your sites. Create a [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) widget first; during deploy you enter its secret, an `ADMIN_TOKEN`, and `ALLOWED_ORIGINS` (the sites that embed comments). The D1 database is created and migrated for you. Then add two lines to any page:

```html
<div class="iseul-comments" data-site-key="<turnstile site key>" data-lang="en"></div>
<script type="module" src="https://<your worker>.workers.dev/embed.js"></script>
```

Optional attributes: `data-slug`, `data-secret="true"`, `data-anonymous="false"`, `data-reactions="👍 ❤️"`. See [template/README.md](template/README.md).

To add iseul to an existing Worker or Pages project instead, follow the quick start.

## Quick start (in your own project)

### 1. Install

```sh
npm install github:SongYunSeop/iseul#v0.1.0
```

### 2. Cloudflare resources

Create the database and bind it as `DB` in `wrangler.toml`, with iseul's migrations:

```sh
npx wrangler d1 create comments
```

```toml
[[d1_databases]]
binding = "DB"
database_name = "comments"
database_id = "<id from d1 create>"
migrations_dir = "node_modules/iseul/migrations"
```

```sh
npx wrangler d1 migrations apply DB --remote   # run again after upgrading iseul
```

Create a [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) widget for your domain. The site key goes in the page; the secret and an admin token go in secrets:

```sh
npx wrangler secret put TURNSTILE_SECRET   # Pages: npx wrangler pages secret put ...
npx wrangler secret put ADMIN_TOKEN
```

### 3. Mount the API

Pages Function (`functions/api/comments.js`):

```js
import { createHandler } from 'iseul/server';
export const onRequest = createHandler();
```

Worker:

```js
import { createHandler } from 'iseul/server';
const comments = createHandler();
export default {
  fetch: (request, env, ctx) => new URL(request.url).pathname === '/api/comments' ? comments(request, env, ctx) : new Response('Not found', { status: 404 }),
};
```

### 4. Add the widget

```js
// with a bundler (Vite, Astro, webpack, ...)
import { mount } from 'iseul/widget';
import 'iseul/widget.css';

mount('#comments', { siteKey: '<turnstile site key>', lang: 'en' }); // <div id="comments"></div>
```

| Option | Default | |
| --- | --- | --- |
| `siteKey` | (required) | Turnstile site key |
| `endpoint` | `/api/comments` | Where the API is mounted |
| `slug` | `location.pathname` | Which thread to show. Use `location.host + location.pathname` to share one database across sites |
| `lang` | `ko` | `ko` or `en` |
| `reactions` | 👍 ❤️ 😂 😮 😢 | Emoji to offer; the server accepts any single emoji. `[]` hides reactions |
| `anonymous` | `true` | `false` makes the name required |
| `secret` | `false` | `true` offers "visible to the site admin only". Replies in a private thread are private too |

These options shape the form; the server accepts any combination, so a direct API call can still post anonymously or privately.

## Server

```js
createHandler({
  isAdmin,        // (request, env) => boolean. Default: tokenAdmin
  canComment,     // (slug, request, env) => boolean. Default: any slug up to 300 characters
  origins,        // other origins allowed to call the API. Default: [] (writes from other sites are refused, against CSRF)
  webhookContent, // include name and body in webhook notifications. Default: false
});
```

A private comment (`secret: true`) reaches the public API without its name, body, or reactions; its author can still delete it with the password.

Limits: name up to 40 characters, body 1 to 2,000, password 4 to 100. Every post, edit, and delete needs a fresh Turnstile token, which also throttles password guessing; reactions do not, so put a rate limit in front of them (below, or a WAF rate-limiting rule). Writes from browsers on other sites are refused unless listed in `origins`. Replies attach to a top-level comment, expire no later than it, and are hidden with it.

Optional env:

| Env | |
| --- | --- |
| `WEBHOOK_URL` | Each new visitor comment is POSTed as `{ text, content, comment }`: `text` for Slack, `content` for Discord, `comment` for anything else. By default it says only where and until when (`💬 New comment on …/hello/ (fades 2026-11-25)`). With `webhookContent: true` it adds the name and the body as a quote. |
| `RATE_LIMITER` | A [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) binding (Workers; on Pages, use a WAF rate-limiting rule on the API path). Posts, edits, deletes, and reactions are limited per client IP, which Cloudflare counts and iseul never stores. |

```toml
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 10, period = 60 }
```

## Admin

Admin requests use `?admin` on the same endpoint. Choose who counts as an admin:

```js
import { createHandler, tokenAdmin, accessAdmin } from 'iseul/server';

createHandler();                         // Authorization: Bearer <ADMIN_TOKEN>
createHandler({ isAdmin: accessAdmin }); // Cloudflare Access JWT; env ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAIL
createHandler({ isAdmin: async (request, env) => await tokenAdmin(request, env) || accessAdmin(request, env) }); // either, or your own check
```

`accessAdmin` only works on a path behind a Cloudflare Access application, so mount a second copy of the handler there (for example `/admin/api/comments`).

The moderation page:

```js
import { mountAdmin } from 'iseul/admin';
import 'iseul/widget.css';

mountAdmin('#admin', { endpoint: '/api/comments', lang: 'en' }); // <div id="admin"></div>
```

It lists the latest 200 comments and filters them by page and state (live, expired, deleted). It first asks the server without a token, so Cloudflare Access or a cookie check just works; if the server refuses, it asks for `ADMIN_TOKEN` and keeps it in `sessionStorage` for that tab.

## Client

Build your own UI on the same API:

```js
import { createClient } from 'iseul/client';

const comments = createClient('/api/comments');
await comments.list('/posts/hello');
await comments.post({ slug: '/posts/hello', name: '', body: 'Hi', password: '1234', keep: 'week', turnstile: token });
await comments.post({ parent: 1, name: '', body: 'A reply', password: '1234', keep: 'day', turnstile: token });
await comments.react({ id: 1, emoji: '👍' });    // on: false takes it back; resolves to { reactions }
await comments.edit({ id: 1, password: '1234', body: 'Hi again', turnstile: token });
await comments.remove({ id: 1, password: '1234', turnstile: token });

const admin = createClient('/api/comments', { token: '<ADMIN_TOKEN>' });
await admin.admin.list({ slug: '/posts/hello', q: 'spam', status: 'deleted' }); // all optional; latest 200
await admin.admin.pages();                        // [{ slug, count }], most recently commented first
await admin.admin.post({ parent: 1, name: 'Yunseop', body: 'Thanks!' }); // author reply, no password
await admin.admin.export();                       // every comment, oldest first
await admin.admin.remove([1, 2, 3]);              // one id or up to 200, with their replies
```

`keep` is one of `day`, `week`, `month`, `year`, `forever`. Comments come back with `parent_id`, `admin`, `secret`, and `reactions` (`{ "👍": 2 }`); admin lists also carry `deleted_at` and `deleted_by`. An empty `name` means anonymous.

Failed calls throw an `Error` with a `code`: `name`, `body`, `password`, `keep`, `slug`, `page`, `turnstile`, `not_found`, `wrong_password`, `rate`, `emoji`, `forbidden`, `request`, `method`, `id`, or `network`.

## Styling

The widget follows your text color. Override these on `.iseul`:

```css
.iseul { --iseul-ink: #222; --iseul-muted: #777; --iseul-line: #e5e5e5; --iseul-accent: #c33; }
```

## Data

Each comment row holds the page key, name, body, reactions, timestamps, and a password hash. iseul never deletes rows: an expired comment, or one deleted by its author or an admin, is hidden from the public API, and a deletion records `deleted_at` and `deleted_by`. To purge old records, run SQL against D1 yourself.

## Development

```sh
npm test   # Node 22.5+ (node:sqlite runs the real schema and SQL)

cd example # a local Worker with Cloudflare's always-pass Turnstile test keys
npx wrangler d1 execute iseul --local --file ../migrations/0001_init.sql
npx wrangler dev   # http://localhost:8787/example/ and /example/admin (token: dev-admin-token)
```

## License

MIT
