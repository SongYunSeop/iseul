// iseul/server: comment API for Cloudflare Workers and Pages Functions, backed by D1 (migrations/).
// Env: DB (D1 binding), TURNSTILE_SECRET, and ADMIN_TOKEN or the Access vars when admin is used.
// No IP or email is stored. Nothing is ever removed from the database: expired and deleted comments are only hidden
// from the public API and stay on the admin side as a record.
// Authors edit/delete with the password set when posting; only a salted PBKDF2 hash is stored, and every
// author write needs a fresh Turnstile token, which throttles password guessing.
export const keeps = { day: 1, week: 7, month: 30, year: 365, forever: 0 };
const live = '(deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?))';
const text = s => new TextEncoder().encode(s);
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', text(password), 'PBKDF2', false, ['deriveBits']);
  // 100,000 is the Workers PBKDF2 iteration ceiling.
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${b64(salt)}$${await derive(password, salt)}`;
}
async function checkPassword(password, stored) {
  const [salt, hash] = String(stored ?? '').split('$');
  return Boolean(hash) && await derive(password, bytes(salt)) === hash;
}

async function human(env, token) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET ?? '');
  form.append('response', String(token ?? ''));
  const verdict = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then(r => r.json()).catch(() => ({}));
  return verdict.success === true;
}


// Admin check: `Authorization: Bearer <ADMIN_TOKEN>`. Digests are compared, not the secrets, so timing leaks nothing useful.
export async function tokenAdmin(request, env) {
  const given = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!env.ADMIN_TOKEN || !given) return false;
  const digest = async s => b64(await crypto.subtle.digest('SHA-256', text(s)));
  return await digest(given) === await digest(env.ADMIN_TOKEN);
}

// Admin check for a path behind a Cloudflare Access application: re-verifies the Access JWT so a misconfigured app fails closed.
// Env: ACCESS_TEAM_DOMAIN (xxx.cloudflareaccess.com), ACCESS_AUD, ADMIN_EMAIL.
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
export async function accessAdmin(request, env) {
  try {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return false;
    const [h, p, s] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(bytes(h)));
    const claims = JSON.parse(new TextDecoder().decode(bytes(p)));
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    if (header.alg !== 'RS256' || claims.iss !== issuer || ![].concat(claims.aud).includes(env.ACCESS_AUD)
      || !(claims.exp * 1000 > Date.now()) || claims.email?.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return false;
    const { keys } = await (await fetch(`${issuer}/cdn-cgi/access/certs`)).json();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, RSA, false, ['verify']);
    return await crypto.subtle.verify(RSA, key, bytes(s), text(`${h}.${p}`));
  } catch { return false; }
}

// Any single standard emoji is accepted as a reaction; the widget's mount({ reactions }) decides which ones to offer.
// ponytail: no cap on distinct emoji per comment (bounded by the ~3,700 RGI emoji and the rate limit); add one if abused.
const oneEmoji = new RegExp('^\\p{RGI_Emoji}$', 'v'); // constructor, so bundlers leave the v flag alone
const columns = 'id, slug, parent_id, name, body, admin, secret, reactions, created_at, expires_at, deleted_at, deleted_by';
// Public reads never carry a secret comment's name, body, or reactions; only the admin side sees them.
const publicColumns = "id, parent_id, CASE WHEN secret THEN '' ELSE name END AS name, CASE WHEN secret THEN '' ELSE body END AS body, admin, secret, CASE WHEN secret THEN NULL ELSE reactions END AS reactions, created_at, expires_at";
const shape = row => ({ ...row, admin: Boolean(row.admin), secret: Boolean(row.secret), reactions: JSON.parse(row.reactions ?? '{}') });
const earlier = (a, b) => (a && b ? (a < b ? a : b) : a ?? b);

// Optional Workers Rate Limiting binding `RATE_LIMITER`, keyed by the client IP, which is only counted by Cloudflare, never stored.
const limited = async (request, env) => Boolean(env.RATE_LIMITER) && !(await env.RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success;

// Optional WEBHOOK_URL: posts each new visitor comment. `text` suits Slack, `content` suits Discord, `comment` is the raw data.
// By default it carries no name or body, so nothing outlives the comment in the receiving chat; withContent adds them.
// Visitor text is escaped for Slack (no <!channel>, no disguised <url|label> links) and Discord mentions are turned off.
const sitePath = slug => /^\/(?![/\\])/.test(slug); // a same-site path, never //host or /\host
function notify(env, comment, request, withContent) {
  if (!env.WEBHOOK_URL) return null;
  const where = sitePath(comment.slug) ? new URL(comment.slug, request.url).href : comment.slug;
  const fades = comment.expires_at ? ` (fades ${comment.expires_at.slice(0, 10)})` : '';
  const lock = comment.secret ? '🔒 ' : '';
  const message = esc => withContent
    ? `${lock}💬 ${esc(comment.name || 'Anonymous')} on ${esc(where)}${fades}:\n${esc(comment.body).replace(/^/gm, '> ')}`
    : `${lock}💬 New ${comment.secret ? 'private ' : ''}${comment.parent_id == null ? 'comment' : 'reply'} on ${esc(where)}${fades}`;
  const slack = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { name, body, ...meta } = comment;
  return fetch(env.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message(slack), content: message(s => s).slice(0, 2000), allowed_mentions: { parse: [] }, comment: withContent ? comment : meta }) }).catch(() => {});
}

// The live top-level comment a reply attaches to (replies to replies attach to the same top-level comment).
const thread = (db, id, now) => db.prepare(`SELECT id, slug, expires_at, secret FROM comments WHERE id = (SELECT coalesce(parent_id, id) FROM comments WHERE id = ?) AND ${live}`).bind(Number(id), now).first();

// Returns a handler usable as a Worker `fetch(request, env, ctx)` or a Pages Function `onRequest(context)`.
// Mount it on one path; `?admin` requests go through isAdmin. Errors are codes (see README) for the UI to translate.
// webhookContent: include name and body in WEBHOOK_URL notifications (they then stay in that chat after the comment fades).
export function createHandler({ isAdmin = tokenAdmin, canComment = () => true, origins = [], webhookContent = false } = {}) {
  return async (first, second, third) => {
    const [request, env, ctx] = first instanceof Request ? [first, second, third] : [first.request, first.env, first];
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
      ...(origins.includes(origin) && { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }) };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    const { method } = request, url = new URL(request.url), db = env.DB, now = new Date().toISOString();
    const later = promise => promise && (ctx?.waitUntil ? ctx.waitUntil(promise) : promise);
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // CSRF: a browser write from another site carries its Origin; only this origin and listed origins may write.
    if (method !== 'GET' && origin && origin !== url.origin && !origins.includes(origin)) return reply({ error: 'forbidden' }, 403);
    const read = () => request.json().then(input => (input && typeof input === 'object' ? input : null), () => null);
    // Deleting hides a comment (and the replies of a top-level one) and records when and by whom; the row stays.
    const remove = (ids, by) => db.prepare(`UPDATE comments SET deleted_at = ?2, deleted_by = ?3
      WHERE deleted_at IS NULL AND (id IN (SELECT value FROM json_each(?1)) OR parent_id IN (SELECT value FROM json_each(?1)))`).bind(JSON.stringify(ids), now, by).run();

    if (url.searchParams.has('admin')) {
      if (!(await isAdmin(request, env))) return reply({ error: 'forbidden' }, 403);
      if (method === 'GET') {
        // ?pages: pages that have comments, most recently commented first.
        if (url.searchParams.has('pages')) return reply((await db.prepare('SELECT slug, count(*) AS count FROM comments GROUP BY slug ORDER BY max(id) DESC').all()).results);
        // ?export: every comment, oldest first.
        if (url.searchParams.has('export')) return reply((await db.prepare(`SELECT ${columns} FROM comments ORDER BY id`).all()).results.map(shape));
        // Latest 200, optionally for one page (?slug=), matching name or body (?q=), and in one state (?status=live|expired|deleted).
        const slug = url.searchParams.get('slug') ?? '', q = (url.searchParams.get('q') ?? '').trim(), status = url.searchParams.get('status') ?? '';
        const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
        return reply((await db.prepare(`SELECT ${columns} FROM comments
          WHERE (?1 = '' OR slug = ?1) AND (?2 = '' OR name LIKE ?3 ESCAPE '\\' OR body LIKE ?3 ESCAPE '\\')
            AND (?4 = '' OR (?4 = 'deleted' AND deleted_at IS NOT NULL) OR (?4 = 'expired' AND deleted_at IS NULL AND expires_at <= ?5)
              OR (?4 = 'live' AND ${live.replace('?', '?5')}))
          ORDER BY id DESC LIMIT 200`).bind(slug, q, like, status, now).all()).results.map(shape));
      }
      if (method === 'POST') {
        // Admin comment: no password, kept until its thread fades, secret when its thread is. { parent } for a reply, or { slug } for a new thread.
        const input = await read();
        if (!input) return reply({ error: 'request' }, 400);
        const name = String(input.name ?? '').trim(), body = String(input.body ?? '').trim();
        if (name.length > 40) return reply({ error: 'name' }, 400);
        if (!body || body.length > 2000) return reply({ error: 'body' }, 400);
        const top = input.parent == null ? null : await thread(db, input.parent, now);
        if (input.parent != null && !top) return reply({ error: 'not_found' }, 404);
        const slug = top?.slug ?? String(input.slug ?? '');
        if (!slug || slug.length > 300) return reply({ error: 'slug' }, 400);
        await db.prepare('INSERT INTO comments (slug, parent_id, name, body, admin, secret, created_at, expires_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
          .bind(slug, top?.id ?? null, name, body, top?.secret ? 1 : 0, now, top?.expires_at ?? null).run();
        return reply({ ok: true }, 201);
      }
      if (method !== 'DELETE') return reply({ error: 'method' }, 405);
      // One or many: ?id=1&id=2 (up to 200). json_each keeps it to one bound parameter (D1 caps them at 100).
      const ids = url.searchParams.getAll('id').map(Number);
      if (!ids.length || ids.length > 200 || !ids.every(Number.isInteger)) return reply({ error: 'id' }, 400);
      await remove(ids, 'admin');
      return reply({ ok: true });
    }

    if (method === 'GET') {
      const slug = url.searchParams.get('slug');
      if (!slug) return reply({ error: 'slug' }, 400);
      return reply((await db.prepare(`SELECT ${publicColumns} FROM comments WHERE slug = ? AND ${live} ORDER BY id`).bind(slug, now).all()).results.map(shape));
    }
    if (!['POST', 'PUT', 'DELETE'].includes(method)) return reply({ error: 'method' }, 405);
    const input = await read();
    if (!input) return reply({ error: 'request' }, 400);
    if (await limited(request, env)) return reply({ error: 'rate' }, 429);

    // ?react: { id, emoji, on } adds (or with on: false removes) one reaction. No Turnstile; the rate limit covers it.
    if (method === 'POST' && url.searchParams.has('react')) {
      if (!oneEmoji.test(String(input.emoji ?? ''))) return reply({ error: 'emoji' }, 400);
      const path = `$."${input.emoji}"`;
      const row = await db.prepare(`UPDATE comments SET reactions = json_set(coalesce(reactions, '{}'), ?1, max(0, coalesce(json_extract(reactions, ?1), 0) + ?2))
        WHERE id = ?3 AND NOT secret AND ${live.replace('?', '?4')} RETURNING reactions`).bind(path, input.on === false ? -1 : 1, Number(input.id), now).first();
      return row ? reply({ reactions: JSON.parse(row.reactions) }) : reply({ error: 'not_found' }, 404);
    }

    const body = String(input.body ?? '').trim(), password = String(input.password ?? '');
    const badBody = !body || body.length > 2000;

    if (method === 'POST') {
      const name = String(input.name ?? '').trim();
      if (name.length > 40) return reply({ error: 'name' }, 400);
      if (badBody) return reply({ error: 'body' }, 400);
      if (password.length < 4 || password.length > 100) return reply({ error: 'password' }, 400);
      if (!Object.hasOwn(keeps, input.keep)) return reply({ error: 'keep' }, 400);
      // { parent } makes it a reply; it can never outlive its thread, and replies in a secret thread are secret.
      // { secret: true } makes it visible to the admin side only.
      const top = input.parent == null ? null : await thread(db, input.parent, now);
      if (input.parent != null && !top) return reply({ error: 'not_found' }, 404);
      const slug = top?.slug ?? String(input.slug ?? '');
      if (!slug || slug.length > 300) return reply({ error: 'slug' }, 400);
      if (!(await canComment(slug, request, env))) return reply({ error: 'page' }, 404);
      if (!(await human(env, input.turnstile))) return reply({ error: 'turnstile' }, 403);
      const days = keeps[input.keep], secret = input.secret === true || Boolean(top?.secret);
      const expires = earlier(days ? new Date(Date.now() + days * 864e5).toISOString() : null, top?.expires_at ?? null);
      const { meta } = await db.prepare('INSERT INTO comments (slug, parent_id, name, body, secret, created_at, expires_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(slug, top?.id ?? null, name, body, secret ? 1 : 0, now, expires, await hashPassword(password)).run();
      await later(notify(env, { id: meta?.last_row_id, slug, parent_id: top?.id ?? null, name, body, secret, created_at: now, expires_at: expires }, request, webhookContent));
      return reply({ ok: true }, 201);
    }

    // PUT edits the body, DELETE hides it (with its replies); both need Turnstile and the comment's password.
    if (method === 'PUT' && badBody) return reply({ error: 'body' }, 400);
    if (!(await human(env, input.turnstile))) return reply({ error: 'turnstile' }, 403);
    const id = Number(input.id);
    const row = await db.prepare(`SELECT password_hash FROM comments WHERE id = ? AND ${live}`).bind(id, now).first();
    if (!row) return reply({ error: 'not_found' }, 404);
    if (!(await checkPassword(password, row.password_hash))) return reply({ error: 'wrong_password' }, 403);
    await (method === 'PUT' ? db.prepare('UPDATE comments SET body = ? WHERE id = ?').bind(body, id).run() : remove([id], 'author'));
    return reply({ ok: true });
  };
}
