// iseul/admin: moderation page UI: latest 200 comments, filter by page, search name/body, delete one or many.
// Style it with iseul/widget.css. Works with any isAdmin: it first tries without a token (Cloudflare Access or your
// own cookie check), and asks for ADMIN_TOKEN only when the server refuses. The token is kept in sessionStorage for the tab.
import { createClient } from './client.js';
import { linkify } from './linkify.js';

const strings = {
  ko: {
    title: '댓글 관리', anonymous: '익명', remove: '삭제', empty: '아직 댓글이 없습니다.', noMatch: '조건에 맞는 댓글이 없습니다.',
    summary: (comments, pages) => `댓글 <b>${comments}</b> · 페이지 <b>${pages}</b>`,
    secret: '비밀', allStates: '모든 상태', states: { live: '공개 중', expired: '만료', deleted: '삭제됨' },
    deleted: (by, when) => `${by === 'admin' ? '관리자가' : '작성자가'} ${when} 삭제 · 운영자만 보임`,
    allPages: '전체 페이지', search: '닉네임·내용 검색', find: '검색', selectAll: '전체 선택', removeSelected: n => `선택 삭제 (${n})`,
    fades: when => `${when} 사라짐`, gone: when => `${when} 사라짐 · 운영자만 보임`, forever: '영원히 남음', operator: '운영자', reply: '답글', replyOf: id => `#${id}의 답글`,
    replySend: '운영자로 답글 남기기', replyName: '표시할 이름 (비우면 운영자)', cancel: '취소', replyFailed: '답글을 남기지 못했습니다.',
    exportJson: 'JSON 내보내기', exportCsv: 'CSV 내보내기', exportFailed: '내보내지 못했습니다.',
    confirm: name => `${name}님의 댓글을 삭제할까요? 공개 화면에서 사라지고 기록은 남습니다.`, confirmMany: n => `댓글 ${n}개를 삭제할까요? 공개 화면에서 사라지고 기록은 남습니다.`,
    token: '관리자 토큰', signIn: '확인', tokenHint: '서버의 ADMIN_TOKEN 값을 입력하세요.', wrongToken: '토큰이 맞지 않습니다.',
    loadFailed: '댓글을 불러오지 못했습니다.', removeFailed: '삭제하지 못했습니다. 다시 시도해 주세요.',
  },
  en: {
    title: 'Comments', anonymous: 'Anonymous', remove: 'Delete', empty: 'No comments yet.', noMatch: 'No comments match.',
    summary: (comments, pages) => `<b>${comments}</b> comment${comments === 1 ? '' : 's'} · <b>${pages}</b> page${pages === 1 ? '' : 's'}`,
    secret: 'Private', allStates: 'All states', states: { live: 'Live', expired: 'Expired', deleted: 'Deleted' },
    deleted: (by, when) => `deleted by ${by === 'admin' ? 'an admin' : 'the author'} ${when} · admins only`,
    allPages: 'All pages', search: 'Search name or comment', find: 'Search', selectAll: 'Select all', removeSelected: n => `Delete selected (${n})`,
    fades: when => `fades ${when}`, gone: when => `faded ${when} · admins only`, forever: 'stays forever', operator: 'Author', reply: 'Reply', replyOf: id => `reply to #${id}`,
    replySend: 'Reply as author', replyName: 'Display name (optional)', cancel: 'Cancel', replyFailed: 'Could not post the reply.',
    exportJson: 'Export JSON', exportCsv: 'Export CSV', exportFailed: 'Could not export.',
    confirm: name => `Delete the comment by ${name}? It leaves the page; the record stays.`, confirmMany: n => `Delete ${n} comments? They leave the page; the records stay.`,
    token: 'Admin token', signIn: 'Sign in', tokenHint: "Enter the server's ADMIN_TOKEN.", wrongToken: 'Wrong token.',
    loadFailed: 'Could not load comments.', removeFailed: 'Could not delete. Please try again.',
  },
};
const key = 'iseul-admin-token';
const stored = () => { try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; } };
const store = token => { try { sessionStorage.setItem(key, token); } catch {} };
const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
const nameKey = 'iseul-admin-name';
const remembered = () => { try { return localStorage.getItem(nameKey) ?? ''; } catch { return ''; } };
const remember = name => { try { localStorage.setItem(nameKey, name); } catch {} };
const csvColumns = ['id', 'slug', 'parent_id', 'name', 'body', 'admin', 'secret', 'reactions', 'created_at', 'expires_at', 'deleted_at', 'deleted_by'];
// Quotes every cell; a leading = + - @ gets a ' so spreadsheets do not run visitor text as a formula.
const csvCell = value => `"${String(value && typeof value === 'object' ? JSON.stringify(value) : value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
const hue = text => [...text].reduce((sum, c) => sum + c.codePointAt(0), 0) * 47 % 360;

export function mountAdmin(target, { endpoint = '/api/comments', lang = 'ko' } = {}) {
  const t = strings[lang] ?? strings.en;
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const relative = iso => {
    const seconds = (new Date(iso) - Date.now()) / 1000;
    const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
    return rtf.format(Math.round(seconds / size), unit);
  };
  const full = iso => new Date(iso).toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short' });
  let client = createClient(endpoint, { token: stored() });

  root.classList.add('iseul', 'iseul-admin');
  root.innerHTML = `<header class="head"><h2>${t.title}</h2><p class="summary"></p></header>
    <form class="token" hidden><label>${t.token} <input type="password" required autocomplete="current-password"></label><p class="note">${t.tokenHint}</p><button type="submit">${t.signIn}</button></form>
    <div class="tools" hidden>
      <form class="filter"><select name="slug" aria-label="${t.allPages}"><option value="">${t.allPages}</option></select><select name="status" aria-label="${t.allStates}"><option value="">${t.allStates}</option>${Object.entries(t.states).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><input type="search" name="q" placeholder="${t.search}" aria-label="${t.search}"><button type="submit">${t.find}</button></form>
      <div class="bulk"><label class="pick"><input type="checkbox" class="all"> ${t.selectAll}</label><span class="spacer"></span><button type="button" class="link export" data-format="json">${t.exportJson}</button><button type="button" class="link export" data-format="csv">${t.exportCsv}</button><button type="button" class="remove-selected" disabled>${t.removeSelected(0)}</button></div>
    </div>
    <p class="status" role="status" aria-live="polite"></p><ol class="cards"></ol>`;
  const $ = selector => root.querySelector(selector);
  const list = $('ol'), status = $('.status'), summary = $('.summary'), tokenForm = $('.token'), tools = $('.tools'), filter = $('.filter'), all = $('.all'), removeSelected = $('.remove-selected');
  const picked = () => [...list.querySelectorAll('input:checked:not(:disabled)')].map(box => Number(box.value));
  const updateBulk = () => {
    const n = picked().length;
    removeSelected.textContent = t.removeSelected(n);
    removeSelected.disabled = !n;
    all.checked = n > 0 && n === list.querySelectorAll('.card > input:not(:disabled)').length;
  };
  const say = (text, empty = false) => { status.textContent = text; status.classList.toggle('empty', empty); };

  tokenForm.addEventListener('submit', async event => {
    event.preventDefault();
    const token = tokenForm.querySelector('input').value;
    client = createClient(endpoint, { token });
    if (await load()) store(token);
  });
  filter.addEventListener('submit', event => { event.preventDefault(); load(); });
  filter.slug.addEventListener('change', () => load());
  filter.status.addEventListener('change', () => load());
  list.addEventListener('change', updateBulk);
  all.addEventListener('change', () => { list.querySelectorAll('.card > input:not(:disabled)').forEach(box => { box.checked = all.checked; }); updateBulk(); });
  removeSelected.addEventListener('click', () => remove(picked(), t.confirmMany(picked().length), removeSelected));
  root.querySelectorAll('.export').forEach(button => button.addEventListener('click', () => download(button.dataset.format)));

  async function download(format) {
    try {
      const rows = await client.admin.export();
      const text = format === 'json' ? JSON.stringify(rows, null, 2)
        : `\ufeff${[csvColumns.join(','), ...rows.map(row => csvColumns.map(c => csvCell(row[c])).join(','))].join('\r\n')}`;
      const href = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' }));
      Object.assign(document.createElement('a'), { href, download: `comments-${new Date().toISOString().slice(0, 10)}.${format}` }).click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { say(t.exportFailed); }
  }

  function replyForm(li, comment) {
    li.querySelector('.reply-form')?.remove();
    const form = document.createElement('form');
    form.className = 'reply-form';
    form.innerHTML = `<input name="name" maxlength="40" placeholder="${t.replyName}" autocomplete="off"><textarea name="body" required maxlength="2000" rows="3"></textarea>
      <div class="actions"><button type="submit">${t.replySend}</button><button type="button" class="secondary">${t.cancel}</button></div>`;
    form.name.value = remembered();
    form.querySelector('.secondary').addEventListener('click', () => form.remove());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      try {
        await client.admin.post({ parent: comment.id, name: form.name.value.trim(), body: form.body.value });
        remember(form.name.value.trim());
        await load();
      } catch { say(t.replyFailed); submit.disabled = false; }
    });
    li.querySelector('.main').append(form);
    form.body.focus();
  }

  async function remove(ids, question, button) {
    if (!confirm(question)) return;
    button.disabled = true;
    try { await client.admin.remove(ids); await load(); } catch { say(t.removeFailed); button.disabled = false; }
  }

  function card(comment) {
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = `<input type="checkbox"><span class="avatar" aria-hidden="true"></span>
      <div class="main"><p class="meta"><strong></strong> <time></time></p><p class="body"></p><p class="foot"><a class="chip"></a> <span class="pill"></span></p></div>
      <div class="side"></div>`;
    const name = comment.name || (comment.admin ? '' : t.anonymous);
    const box = li.querySelector('input');
    box.value = comment.id;
    box.setAttribute('aria-label', `${name || t.operator}: ${comment.body.slice(0, 40)}`);
    const avatar = li.querySelector('.avatar');
    avatar.textContent = [...(name || t.operator)][0].toUpperCase();
    avatar.style.setProperty('--hue', hue(name || t.operator));
    li.querySelector('strong').textContent = name;
    if (comment.admin) li.querySelector('strong').insertAdjacentHTML('afterend', ` <span class="badge">${t.operator}</span>`);
    if (comment.secret) li.querySelector('.meta time').insertAdjacentHTML('beforebegin', `<span class="badge secret">🔒 ${t.secret}</span> `);
    const time = li.querySelector('time');
    time.textContent = relative(comment.created_at);
    time.title = full(comment.created_at);
    time.setAttribute('datetime', comment.created_at);
    linkify(li.querySelector('.body'), comment.body);
    const page = li.querySelector('.chip');
    page.textContent = comment.slug;
    if (/^\/(?![/\\])/.test(comment.slug)) page.href = comment.slug; // same-site paths only, never //host
    const pill = li.querySelector('.pill');
    if (comment.deleted_at) {
      pill.textContent = t.deleted(comment.deleted_by, relative(comment.deleted_at));
      pill.title = full(comment.deleted_at);
      li.classList.add('gone');
      box.disabled = true;
      box.style.visibility = 'hidden';
    } else if (comment.expires_at) {
      const left = new Date(comment.expires_at) - Date.now();
      pill.textContent = (left > 0 ? t.fades : t.gone)(relative(comment.expires_at));
      pill.title = full(comment.expires_at);
      pill.classList.toggle('soon', left > 0 && left < 864e5);
      li.classList.toggle('gone', left <= 0);
    } else {
      pill.textContent = t.forever;
      pill.classList.add('forever');
    }
    const foot = li.querySelector('.foot');
    if (comment.parent_id != null) foot.insertAdjacentHTML('beforeend', ` <span class="pill">↪ ${t.replyOf(comment.parent_id)}</span>`);
    const counts = Object.entries(comment.reactions).filter(([, n]) => n > 0).map(([e, n]) => `${e} ${n}`).join('  ');
    if (counts) foot.append(' ', Object.assign(document.createElement('span'), { className: 'pill', textContent: counts }));
    const side = li.querySelector('.side');
    if (comment.parent_id == null && !li.classList.contains('gone')) {
      const reply = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: t.reply });
      reply.addEventListener('click', () => replyForm(li, comment));
      side.append(reply);
    }
    if (!comment.deleted_at) {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'link delete', textContent: t.remove });
      button.addEventListener('click', () => remove(comment.id, t.confirm(name || t.operator), button));
      side.append(button);
    }
    return li;
  }

  async function load() {
    const slug = filter.slug.value, q = filter.q.value.trim(), status = filter.status.value;
    try {
      const [comments, pages] = await Promise.all([client.admin.list({ slug, q, status }), client.admin.pages()]);
      tokenForm.hidden = true;
      tools.hidden = false;
      summary.innerHTML = t.summary(pages.reduce((sum, p) => sum + p.count, 0), pages.length);
      filter.slug.replaceChildren(filter.slug.options[0], ...pages.map(p => new Option(`${p.slug} (${p.count})`, p.slug)));
      filter.slug.value = pages.some(p => p.slug === slug) ? slug : '';
      say(comments.length ? '' : slug || q || status ? t.noMatch : t.empty, !comments.length);
      list.replaceChildren(...comments.map(card));
      updateBulk();
      return true;
    } catch (error) {
      list.replaceChildren();
      summary.textContent = '';
      const refused = error.code === 'forbidden';
      tokenForm.hidden = !refused;
      tools.hidden = true;
      say(refused ? (tokenForm.querySelector('input').value ? t.wrongToken : '') : t.loadFailed);
      return false;
    }
  }
  load();
}
