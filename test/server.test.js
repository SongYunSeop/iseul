import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHandler, accessAdmin } from '../src/server.js';
import { createClient } from '../src/client.js';

// Minimal D1 surface (prepare/bind/first/all/run) over node:sqlite so the real schema and SQL run.
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const query = (sql, args = []) => ({ first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { last_row_id: Number(db.prepare(sql).run(...args).lastInsertRowid) } }) });
  return { raw: db, prepare: sql => ({ ...query(sql), bind: (...args) => query(sql, args) }) };
}

// The client talks to the handler through a stubbed fetch; Turnstile passes only for the token 'ok'.
function setup(t, options) {
  const env = { DB: d1(), TURNSTILE_SECRET: 's', ADMIN_TOKEN: 'admin-secret' };
  const handler = createHandler(options);
  const original = globalThis.fetch;
  const hooks = [];
  globalThis.fetch = async (url, init) => String(url).startsWith('https://challenges.cloudflare.com/') ? Response.json({ success: init.body.get('response') === 'ok' })
    : String(url).startsWith('https://hooks.example/') ? (hooks.push(JSON.parse(init.body)), new Response('ok'))
    : handler(new Request(new URL(url, 'https://blog.example'), init), env);
  t.after(() => { globalThis.fetch = original; });
  return { env, hooks, handler, client: createClient('/api/comments'), admin: createClient('/api/comments', { token: 'admin-secret' }) };
}
const code = promise => promise.then(() => 'ok', error => error.code);
const valid = { slug: '/hello/', name: '독자', body: '좋은 글이네요', keep: 'week', password: '1234', turnstile: 'ok' };

test('stores a valid comment with its expiry and lists it for the page', async t => {
  const { env, client } = setup(t);
  await client.post(valid);
  await client.post({ ...valid, keep: 'forever', body: '영원히', name: '  ' });
  const [week, forever] = await client.list('/hello/');
  assert.equal(week.name, '독자');
  assert.ok(Math.abs(new Date(week.expires_at) - Date.now() - 7 * 864e5) < 60e3);
  assert.equal(forever.expires_at, null);
  assert.equal(forever.name, '');
  assert.equal(week.password_hash, undefined);
  assert.match(env.DB.raw.prepare('SELECT password_hash FROM comments WHERE id = 1').get().password_hash, /^[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.deepEqual(await client.list('/other/'), []);
});

test('rejects invalid input, failed Turnstile and pages canComment refuses', async t => {
  const { client } = setup(t, { canComment: slug => slug.startsWith('/') });
  for (const [input, expected] of [[{ ...valid, name: 'x'.repeat(41) }, 'name'], [{ ...valid, body: 'x'.repeat(2001) }, 'body'], [{ ...valid, body: ' ' }, 'body'],
    [{ ...valid, keep: 'decade' }, 'keep'], [{ ...valid, keep: 'toString' }, 'keep'], [{ ...valid, password: '123' }, 'password'], [{ ...valid, slug: '' }, 'slug'],
    [{ ...valid, turnstile: 'bad' }, 'turnstile'], [{ ...valid, slug: 'https://evil.example/' }, 'page']]) {
    assert.equal(await code(client.post(input)), expected, JSON.stringify(input));
  }
  assert.deepEqual(await client.list('/hello/'), []);
});

test('hides expired comments but never removes them', async t => {
  const { env, client } = setup(t);
  env.DB.raw.prepare('INSERT INTO comments (slug, name, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run('/hello/', 'old', 'bye', '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z');
  assert.deepEqual(await client.list('/hello/'), []);
  await client.post(valid);
  assert.equal(env.DB.raw.prepare('SELECT count(*) AS n FROM comments').get().n, 2);
});

test('authors edit and delete only with the right password and a valid Turnstile token', async t => {
  const { env, client } = setup(t);
  await client.post(valid);
  const auth = { id: 1, password: '1234', turnstile: 'ok' };
  assert.equal(await code(client.edit({ ...auth, password: 'wrong', body: '바뀜' })), 'wrong_password');
  assert.equal(await code(client.edit({ ...auth, turnstile: 'bad', body: '바뀜' })), 'turnstile');
  assert.equal(await code(client.edit({ ...auth, body: ' ' })), 'body');
  assert.equal(await code(client.edit({ ...auth, id: 99, body: '바뀜' })), 'not_found');
  assert.equal((await client.list('/hello/'))[0].body, '좋은 글이네요');
  await client.edit({ ...auth, body: '고친 내용' });
  assert.equal((await client.list('/hello/'))[0].body, '고친 내용');
  assert.equal(await code(client.remove({ ...auth, password: 'wrong' })), 'wrong_password');
  await client.remove(auth);
  assert.deepEqual(await client.list('/hello/'), []);
  await client.post(valid);
  env.DB.raw.prepare("UPDATE comments SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(await code(client.edit({ ...auth, id: 2, body: 'x' })), 'not_found');
});

test('admin needs ADMIN_TOKEN by default, and isAdmin can be replaced', async t => {
  const { env, client, admin } = setup(t);
  await client.post(valid);
  assert.equal(await code(client.admin.list()), 'forbidden');
  assert.equal(await code(createClient('/api/comments', { token: 'wrong' }).admin.remove(1)), 'forbidden');
  assert.equal((await admin.admin.list())[0].slug, '/hello/');
  await admin.admin.remove(1);
  assert.deepEqual(await client.list('/hello/'), []);
  delete env.ADMIN_TOKEN;
  assert.equal(await code(admin.admin.list()), 'forbidden');

  const custom = createHandler({ isAdmin: request => request.headers.get('X-Me') === 'yes' });
  assert.equal((await custom(new Request('https://blog.example/api/comments?admin', { headers: { 'X-Me': 'yes' } }), env)).status, 200);
  assert.equal((await accessAdmin(new Request('https://blog.example/', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } }), { ACCESS_TEAM_DOMAIN: 'x', ACCESS_AUD: 'y', ADMIN_EMAIL: 'z' })), false);
});

test('admin filters by page, searches name and body, lists pages, and deletes in bulk', async t => {
  const { client, admin } = setup(t);
  await client.post(valid);
  await client.post({ ...valid, slug: '/other/', name: '봄비', body: '100% 동의' });
  await client.post({ ...valid, slug: '/other/', body: 'Hello World' });
  const bodies = async filter => (await admin.admin.list(filter)).map(c => c.body);
  assert.deepEqual(await bodies({ slug: '/other/' }), ['Hello World', '100% 동의']);
  assert.deepEqual(await bodies({ q: 'hello' }), ['Hello World']);
  assert.deepEqual(await bodies({ q: '봄비' }), ['100% 동의']);
  assert.deepEqual(await bodies({ q: '%' }), ['100% 동의']);
  assert.deepEqual(await bodies({ q: '_' }), []);
  assert.deepEqual(await bodies({ slug: '/hello/', q: 'world' }), []);
  assert.deepEqual(await admin.admin.pages(), [{ slug: '/other/', count: 2 }, { slug: '/hello/', count: 1 }]);
  assert.equal(await code(admin.admin.remove([])), 'id');
  assert.equal(await code(admin.admin.remove(['x'])), 'id');
  await admin.admin.remove([2, 3]);
  assert.deepEqual(await client.list('/other/'), []);
  assert.deepEqual(await bodies({ status: 'live' }), ['좋은 글이네요']);
  assert.deepEqual((await admin.admin.list({ status: 'deleted' })).map(c => [c.body, c.deleted_by]), [['Hello World', 'admin'], ['100% 동의', 'admin']]);
});

test('replies attach to the top-level comment, never outlive it, and are hidden with it', async t => {
  const { env, client } = setup(t);
  await client.post({ ...valid, keep: 'day' });                              // 1
  await client.post({ ...valid, parent: 1, keep: 'forever', body: '답글' }); // 2
  await client.post({ ...valid, parent: 2, body: '답글의 답글' });           // 3 → attaches to 1
  assert.equal(await code(client.post({ ...valid, parent: true })), 'not_found'); // not an id
  const [top, reply, nested] = await client.list('/hello/');
  assert.equal(top.parent_id, null);
  assert.equal(reply.parent_id, 1);
  assert.equal(nested.parent_id, 1);
  assert.equal(reply.expires_at, top.expires_at);
  assert.equal(await code(client.post({ ...valid, parent: 99 })), 'not_found');
  await client.post({ ...valid, slug: '/other/', parent: 1, body: 'slug follows the parent' });
  assert.deepEqual(await client.list('/other/'), []);
  await client.remove({ id: 1, password: '1234', turnstile: 'ok' });
  assert.deepEqual(await client.list('/hello/'), []);
  assert.deepEqual(env.DB.raw.prepare('SELECT deleted_by AS by, count(*) AS n FROM comments GROUP BY deleted_by').all().map(r => ({ ...r })), [{ by: 'author', n: 4 }]);
});

test('admin comments need no password, are flagged, follow their thread, and only admins delete them', async t => {
  const { client, admin } = setup(t);
  await client.post({ ...valid, keep: 'week' });
  assert.equal(await code(client.admin.post({ parent: 1, body: 'x' })), 'forbidden');
  await admin.admin.post({ parent: 1, name: '주인장', body: '감사합니다' });
  await admin.admin.post({ slug: '/hello/', body: '공지' });
  const [, answer, notice] = await client.list('/hello/');
  assert.equal(answer.admin, true);
  assert.equal(answer.parent_id, 1);
  assert.equal(answer.expires_at, (await client.list('/hello/'))[0].expires_at);
  assert.equal(notice.expires_at, null);
  assert.equal(await code(client.remove({ id: 2, password: '', turnstile: 'ok' })), 'wrong_password');
  assert.equal(await code(admin.admin.post({ parent: 99, body: 'x' })), 'not_found');
});

test('reactions count up and down, never below zero, and only known emoji', async t => {
  const { env, client } = setup(t);
  await client.post(valid);
  await client.react({ id: 1, emoji: '👍' });
  assert.deepEqual((await client.react({ id: 1, emoji: '👍' })).reactions, { '👍': 2 });
  assert.deepEqual((await client.react({ id: 1, emoji: '❤️' })).reactions, { '👍': 2, '❤️': 1 });
  await client.react({ id: 1, emoji: '❤️', on: false });
  assert.deepEqual((await client.react({ id: 1, emoji: '❤️', on: false })).reactions, { '👍': 2, '❤️': 0 });
  assert.deepEqual((await client.list('/hello/'))[0].reactions, { '👍': 2, '❤️': 0 });
  assert.equal(await code(client.react({ id: 1, emoji: 'x' })), 'emoji');
  assert.equal(await code(client.react({ id: 9, emoji: '👍' })), 'not_found');
  env.DB.raw.prepare("UPDATE comments SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(await code(client.react({ id: 1, emoji: '👍' })), 'not_found');
});

test('any single standard emoji is a valid reaction, nothing else is', async t => {
  const { client } = setup(t);
  await client.post(valid);
  assert.deepEqual((await client.react({ id: 1, emoji: '🔥' })).reactions, { '🔥': 1 });
  assert.deepEqual((await client.react({ id: 1, emoji: '👍🏽' })).reactions, { '🔥': 1, '👍🏽': 1 });
  for (const emoji of ['BUY NOW', '👍👍', 'a', '', undefined]) assert.equal(await code(client.react({ id: 1, emoji })), 'emoji', String(emoji));
});

test('rate limiter and webhook are used when configured', async t => {
  const { env, hooks, client } = setup(t);
  env.WEBHOOK_URL = 'https://hooks.example/new';
  await client.post({ ...valid, name: '' });
  assert.equal(hooks.length, 1);
  assert.match(hooks[0].text, /^💬 New comment on https:\/\/blog\.example\/hello\/ \(fades \d{4}-\d{2}-\d{2}\)$/);
  assert.equal(hooks[0].content, hooks[0].text);
  assert.equal(hooks[0].comment.id, 1);
  assert.equal(hooks[0].comment.body, undefined);
  assert.equal(hooks[0].comment.name, undefined);
  const keys = [];
  env.RATE_LIMITER = { limit: async ({ key }) => (keys.push(key), { success: false }) };
  assert.equal(await code(client.post(valid)), 'rate');
  assert.equal(await code(client.react({ id: 1, emoji: '👍' })), 'rate');
  assert.deepEqual(keys, ['unknown', 'unknown']);
  assert.equal(hooks.length, 1);
});

test('admin export returns every comment oldest first; bulk delete hides replies too', async t => {
  const { client, admin } = setup(t);
  await client.post(valid);
  await client.post({ ...valid, parent: 1, body: '답글' });
  await client.post({ ...valid, slug: '/other/', body: '다른 글' });
  await client.react({ id: 3, emoji: '😂' });
  const all = await admin.admin.export();
  assert.deepEqual(all.map(c => [c.id, c.slug, c.parent_id]), [[1, '/hello/', null], [2, '/hello/', 1], [3, '/other/', null]]);
  assert.deepEqual(all[2].reactions, { '😂': 1 });
  assert.equal(all[0].password_hash, undefined);
  await admin.admin.remove([1]);
  assert.deepEqual((await admin.admin.export()).map(c => [c.id, c.deleted_by]), [[1, 'admin'], [2, 'admin'], [3, null]]);
});

test('admin status filter separates live, expired, and deleted comments', async t => {
  const { env, client, admin } = setup(t);
  for (const body of ['살아 있음', '만료됨', '지워짐']) await client.post({ ...valid, body });
  env.DB.raw.prepare("UPDATE comments SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = 2").run();
  await client.remove({ id: 3, password: '1234', turnstile: 'ok' });
  const bodies = async status => (await admin.admin.list({ status })).map(c => c.body);
  assert.deepEqual(await bodies('live'), ['살아 있음']);
  assert.deepEqual(await bodies('expired'), ['만료됨']);
  assert.deepEqual(await bodies('deleted'), ['지워짐']);
  assert.deepEqual(await bodies(''), ['지워짐', '만료됨', '살아 있음']);
  assert.equal(await code(client.edit({ id: 2, password: '1234', body: 'x', turnstile: 'ok' })), 'not_found');
  assert.equal(await code(client.remove({ id: 3, password: '1234', turnstile: 'ok' })), 'not_found');
});

test('webhookContent puts the name and body into the notification', async t => {
  const { env, hooks, client } = setup(t, { webhookContent: true });
  env.WEBHOOK_URL = 'https://hooks.example/new';
  await client.post({ ...valid, keep: 'forever' });
  await client.post({ ...valid, parent: 1, name: '' });
  assert.equal(hooks[0].text, '💬 독자 on https://blog.example/hello/:\n> 좋은 글이네요');
  await client.post({ ...valid, body: '첫 줄\n둘째 줄' });
  assert.match(hooks[2].text, /:\n> 첫 줄\n> 둘째 줄$/);
  assert.equal(hooks[0].comment.body, '좋은 글이네요');
  assert.match(hooks[1].text, /^💬 Anonymous on https:\/\/blog\.example\/hello\/ \(fades /);
  await client.post({ ...valid, quote: { text: '<b>인용</b>' } });
  assert.match(hooks[3].text, /:\n“&lt;b&gt;인용&lt;\/b&gt;”\n> 좋은 글이네요$/);
  assert.equal(hooks[3].comment.quote.text, '<b>인용</b>');
  await client.post({ ...valid, quote: { text: '첫 줄\n💬 가짜 알림' } });
  assert.match(hooks[4].text, /“첫 줄 💬 가짜 알림”/);
  await client.post({ ...valid, name: 'a\n> 가짜 줄', body: '[관리자](https://evil.example)' });
  assert.match(hooks[5].text, /^💬 a &gt; 가짜 줄 on /);
  assert.match(hooks[5].content, /\\\[관리자\\\]\(https:\/\/evil\.example\)$/);
});

test('secret comments: placeholder in public, full on the admin side, replies inherit secrecy', async t => {
  const { env, hooks, client, admin } = setup(t);
  env.WEBHOOK_URL = 'https://hooks.example/new';
  await client.post({ ...valid, secret: true, body: '운영자만 보세요' });   // 1
  await client.post({ ...valid, parent: 1, body: '답글도 비밀' });          // 2 → secret via thread
  await admin.admin.post({ parent: 1, body: '확인했어요' });                // 3 → secret via thread
  await client.post({ ...valid, secret: 'yes', body: '공개' });             // 4 → only `true` counts
  assert.equal(await code(client.react({ id: 1, emoji: '👍' })), 'not_found');
  const pub = await client.list('/hello/');
  assert.deepEqual(pub.map(c => [c.id, c.secret, c.name, c.body]), [[1, true, '', ''], [2, true, '', ''], [3, true, '', ''], [4, false, '독자', '공개']]);
  assert.deepEqual(pub[0].reactions, {});
  assert.deepEqual((await admin.admin.list()).filter(c => c.secret).map(c => c.body).sort(), ['답글도 비밀', '운영자만 보세요', '확인했어요']);
  assert.match(hooks[0].text, /^🔒 💬 New private comment on /);
  await client.remove({ id: 1, password: '1234', turnstile: 'ok' });
  assert.deepEqual((await client.list('/hello/')).map(c => c.id), [4]);
});

test('writes from another site are refused (CSRF); reads, same-origin, and listed origins pass', async t => {
  const { env, handler } = setup(t, { origins: ['https://friend.example'] });
  const write = (origin, query = '') => handler(new Request(`https://blog.example/api/comments${query}`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...(origin && { Origin: origin }) }, body: JSON.stringify({ ...valid, id: 1, emoji: '👍' }) }), env);
  assert.equal((await write('https://evil.example')).status, 403);
  assert.equal((await write('https://evil.example', '?react')).status, 403);
  assert.equal((await write('https://evil.example', '?admin')).status, 403);
  assert.equal((await write('https://blog.example')).status, 201);
  assert.equal((await write('https://friend.example')).status, 201);
  assert.equal((await write(null)).status, 201);
  assert.equal((await handler(new Request('https://blog.example/api/comments?slug=/hello/', { headers: { Origin: 'https://evil.example' } }), env)).status, 200);
});

test('webhook text escapes Slack markup, turns off Discord mentions, and never links off-site slugs', async t => {
  const { env, hooks, client } = setup(t, { webhookContent: true });
  env.WEBHOOK_URL = 'https://hooks.example/new';
  await client.post({ ...valid, keep: 'forever', name: '<!channel>', body: '<https://evil.example|https://blog.example/admin/> & more' });
  assert.equal(hooks[0].text, '💬 &lt;!channel&gt; on https://blog.example/hello/:\n> &lt;https://evil.example|https://blog.example/admin/&gt; &amp; more');
  assert.equal(hooks[0].content, '💬 <!channel> on https://blog.example/hello/:\n> <https://evil.example|https://blog.example/admin/> & more');
  assert.deepEqual(hooks[0].allowed_mentions, { parse: [] });
  await client.post({ ...valid, slug: '//evil.example/phish' });
  assert.match(hooks[1].text, / on \/\/evil\.example\/phish /);
  await client.post({ ...valid, slug: '//' });
  assert.equal(hooks.length, 3);
});

test('quotes are validated, stored with the comment, and hidden on private comments', async t => {
  const { client, admin } = setup(t);
  const quote = { text: '비 오기 전', prefix: '오늘 저녁, ', suffix: ' 산책을 나갔다.', index: 1 };
  await client.post({ ...valid, quote });
  await client.post({ ...valid, quote, secret: true });
  await client.post(valid);
  const [quoted, hidden, plain] = await client.list('/hello/');
  assert.deepEqual(quoted.quote, quote);
  assert.equal(hidden.quote, null);
  assert.equal(plain.quote, null);
  assert.deepEqual((await admin.admin.list()).find(c => c.id === 2).quote, quote);
  for (const bad of [{ text: '' }, { text: 'x'.repeat(301) }, { text: 'a', prefix: 'x'.repeat(61) }, { text: 'a', suffix: 'x'.repeat(61) }, { text: 'a', index: -1 }, { text: 'a', index: 1.5 }, { text: 'a', index: 1001 }, 'a string', { text: { a: 1 } }, { text: 'a', prefix: 1 }]) {
    assert.equal(await code(client.post({ ...valid, quote: bad })), 'quote', JSON.stringify(bad));
  }
});

test('works as a Pages Function and sends CORS headers only to listed origins', async t => {
  const { env } = setup(t);
  const handler = createHandler({ origins: ['https://site.example'] });
  const preflight = origin => handler({ request: new Request('https://api.example/comments', { method: 'OPTIONS', headers: { Origin: origin } }), env });
  assert.equal((await preflight('https://site.example')).headers.get('Access-Control-Allow-Origin'), 'https://site.example');
  assert.equal((await preflight('https://evil.example')).headers.get('Access-Control-Allow-Origin'), null);
});

test('a database that misses a migration answers a JSON server error and says why in the log', async t => {
  const { env, client } = setup(t);
  env.DB.raw.exec('ALTER TABLE comments DROP COLUMN quote');
  const logged = [];
  t.mock.method(console, 'error', message => logged.push(message));
  assert.equal(await code(client.list('/hello/')), 'server');
  assert.match(logged[0], /no such column: quote.*migrations apply/);
});

test('admin search also matches the quoted passage', async t => {
  const { client, admin } = setup(t);
  await client.post({ ...valid, quote: { text: '찾을 인용문' } });
  await client.post({ ...valid, parent: '1' }); // an id as text still works
  assert.deepEqual((await admin.admin.list({ q: '찾을 인용' })).map(c => c.id), [1]);
  assert.equal((await client.list('/hello/'))[1].parent_id, 1);
});
