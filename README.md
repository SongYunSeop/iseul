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
- **Quote comments.** Optionally, readers select a sentence to comment on it; quoted passages can be highlighted with badges in the margin.
- **Small.** No dependencies. The widget is about 15 KB gzipped, in Korean or English.

Five entry points: `iseul/server` (API handler), `iseul/client` (fetch wrapper for your own UI), `iseul/widget` (ready-made comments UI), `iseul/admin` (moderation page), and `iseul/embed` (script tag for pages without a bundler).

## Deploy to Cloudflare

The button above deploys [`template/`](template): one Worker with the API, the moderation page at `/admin`, and `embed.js` for your sites. Create a [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) widget first; during deploy you enter its secret, an `ADMIN_TOKEN`, and `ALLOWED_ORIGINS` (the sites that embed comments). The D1 database is created and migrated for you. Then add two lines to any page:

```html
<div class="iseul-comments" data-site-key="<turnstile site key>" data-lang="en"></div>
<script type="module" src="https://<your worker>.workers.dev/embed.js"></script>
```

Optional attributes: `data-slug`, `data-secret="true"`, `data-anonymous="false"`, `data-reactions="👍 ❤️"`, `data-quote="article"`, `data-quote-marks="true"`. See [template/README.md](template/README.md).

To add iseul to an existing Worker or Pages project instead, follow the quick start.

## Quick start (in your own project)

### 1. Install

```sh
npm install github:SongYunSeop/iseul#v0.2.0
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
| `quote` | (off) | The article element or its selector, e.g. `'.prose'`. Selecting text in it offers "quote in a comment"; the quote (up to 300 characters) shows above the comment and links back to the passage. The element must exist when `mount` runs and must not contain the comments |
| `quoteMarks` | `false` | With `quote`: highlight quoted passages (click one to read its comments) and put count badges in the margin, `true`/`'right'` or `'left'`, when it is at least 56px wide. Positions follow the page's scroll, so an article inside its own scrolling box is not supported |

These options shape the form; the server accepts any combination, so a direct API call can still post anonymously or privately.

`mount` returns `unmount()`, which removes the widget and everything it added to the page (badges, listeners, highlights). Call it before mounting again on a page that changes without reloading.

## Server

```js
createHandler({
  isAdmin,        // (request, env) => boolean. Default: tokenAdmin
  canComment,     // (slug, request, env) => boolean. Default: any slug up to 300 characters
  origins,        // other origins allowed to call the API. Default: [] (writes from other sites are refused, against CSRF)
  webhookContent, // include name and body in webhook notifications. Default: false
});
```

A private comment (`secret: true`) reaches the public API without its name, body, reactions, or quote; its author can still delete it with the password.

Limits: name up to 40 characters, body 1 to 2,000, password 4 to 100, quote 1 to 300 with up to 60 characters of context on each side. Every post, edit, and delete needs a fresh Turnstile token, which also throttles password guessing; reactions do not, so put a rate limit in front of them (below, or a WAF rate-limiting rule). Writes from browsers on other sites are refused unless listed in `origins`. Replies attach to a top-level comment, expire no later than it, and are hidden with it.

Optional env:

| Env | |
| --- | --- |
| `WEBHOOK_URL` | Each new visitor comment is POSTed as `{ text, content, comment }`: `text` for Slack, `content` for Discord, `comment` for anything else. By default it says only where and until when (`💬 New comment on …/hello/ (fades 2026-11-25)`). With `webhookContent: true` it adds the name, the quoted passage if any, and the body. Links point at the page's site (the posting origin when it is in `origins`). |
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
// site: 'https://blog.example' when the page links should point at another origin (default: this page's)
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
await comments.post({ slug: '/posts/hello', name: '', body: 'So true', password: '1234', keep: 'week', turnstile: token, quote: { text: 'a quoted sentence', prefix: '…', suffix: '…', index: 0 } });
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

`keep` is one of `day`, `week`, `month`, `year`, `forever`. Comments come back with `parent_id`, `admin`, `secret`, `reactions` (`{ "👍": 2 }`), and `quote` (`{ text, prefix, suffix, index }` or `null`); admin lists also carry `deleted_at` and `deleted_by`. An empty `name` means anonymous.

Failed calls throw an `Error` with a `code`: `name`, `body`, `password`, `keep`, `slug`, `page`, `turnstile`, `not_found`, `wrong_password`, `rate`, `emoji`, `quote`, `forbidden`, `request`, `method`, `id`, `server` (an unexpected failure, such as a missing migration; the details go to the Worker log), or `network`.

## Styling

The widget follows your text color. Override these on `.iseul`:

```css
.iseul { --iseul-ink: #222; --iseul-muted: #777; --iseul-line: #e5e5e5; --iseul-accent: #c33; }
```

Quote comments draw outside the widget (badges, highlights, the comment popover, the quote button) and take their colors from it, so they follow your theme: `--iseul-quote-color` for badges and highlights (default `--iseul-accent`), `--iseul-quote-ink` for the badge text (default white), and `--iseul-quote-surface` for the popover background (default: the background behind the widget). The popover text and the quote button use the widget's text color. To restyle further, target `.iseul-quote-mark`, `.iseul-quote-list`, `.iseul-quote-pick`, and `::highlight(iseul-quote)`.

## Data

Each comment row holds the page key, name, body, reactions, the quoted passage if any, timestamps, and a password hash. iseul never deletes rows: an expired comment, or one deleted by its author or an admin, is hidden from the public API, and a deletion records `deleted_at` and `deleted_by`. To purge old records, run SQL against D1 yourself.

## Upgrading

Apply the new migrations first, then deploy the new version: new code fails on a database that lacks its columns, while the old code runs fine on a migrated one.

```sh
npx wrangler d1 migrations apply DB --remote
```

If you created the table with `d1 execute --file` instead of `migrations_dir`, run only the files you have not run yet (0.2.0 adds `migrations/0002_quote.sql`), and keep doing it that way: `migrations apply` does not know about files run by hand and would run them again. The Deploy to Cloudflare template applies migrations on every deploy.

## Development

```sh
npm test   # Node 22.5+ (node:sqlite runs the real schema and SQL)

cd example # a local Worker with Cloudflare's always-pass Turnstile test keys
npx wrangler d1 execute iseul --local --file ../migrations/0001_init.sql
npx wrangler d1 execute iseul --local --file ../migrations/0002_quote.sql
npx wrangler dev   # http://localhost:8787/example/ and /example/admin (token: dev-admin-token)
```

## License

MIT
