// iseul/widget: default comment UI built on iseul/client. Style it with iseul/widget.css.
import { createClient } from './client.js';
import { linkify } from './linkify.js';

const strings = {
  ko: {
    title: '댓글', name: '닉네임', anonymous: '익명', secretLabel: '관리자에게만 보이기', secretText: '비밀 댓글입니다.', password: '비밀번호', keep: '남길 기간', body: '내용', operator: '운영자',
    keeps: { day: '하루', week: '일주일', month: '한 달', year: '일 년', forever: '영원히' },
    note: '기간이 지나면 댓글이 사라집니다. 비밀번호는 댓글을 고치거나 지울 때 필요합니다.',
    submit: '댓글 남기기', submitReply: '답글 남기기', sending: '등록하고 있습니다.', sent: '댓글을 남겼습니다.', loadFailed: '댓글을 불러오지 못했습니다.',
    reply: '답글', replyingTo: name => `${name}님에게 답글`, react: e => `${e} 반응`,
    edit: '수정', remove: '삭제', save: '저장', cancel: '취소', confirm: '이 댓글을 지울까요? 달린 답글도 함께 화면에서 사라집니다.', until: day => `${day}까지 남아요`,
    errors: {
      name: '닉네임은 40자 이하로 입력해 주세요.', body: '내용은 1~2,000자로 입력해 주세요.', password: '비밀번호는 4~100자로 입력해 주세요.',
      keep: '남길 기간을 선택해 주세요.', page: '댓글을 달 수 없는 글입니다.', turnstile: '자동 등록 방지 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      not_found: '댓글을 찾을 수 없습니다. 이미 사라졌을 수 있어요.', wrong_password: '비밀번호가 맞지 않습니다.', rate: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      other: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
  },
  en: {
    title: 'Comments', name: 'Name', anonymous: 'Anonymous', secretLabel: 'Visible to the site admin only', secretText: 'A private comment.', password: 'Password', keep: 'Keep for', body: 'Comment', operator: 'Author',
    keeps: { day: 'A day', week: 'A week', month: 'A month', year: 'A year', forever: 'Forever' },
    note: 'Comments disappear when their time is up. The password lets you edit or delete your comment.',
    submit: 'Post comment', submitReply: 'Post reply', sending: 'Posting…', sent: 'Your comment is up.', loadFailed: 'Could not load comments.',
    reply: 'Reply', replyingTo: name => `Replying to ${name}`, react: e => `React with ${e}`,
    edit: 'Edit', remove: 'Delete', save: 'Save', cancel: 'Cancel', confirm: 'Delete this comment? Its replies disappear from the page too.', until: day => `stays until ${day}`,
    errors: {
      name: 'Names can be up to 40 characters.', body: 'Comments must be 1 to 2,000 characters.', password: 'Passwords must be 4 to 100 characters.',
      keep: 'Choose how long to keep the comment.', page: 'Comments are closed on this page.', turnstile: 'The bot check failed. Please try again in a moment.',
      not_found: 'That comment is gone.', wrong_password: 'Wrong password.', rate: 'Too many requests. Please wait a moment.',
      other: 'Something went wrong. Please try again in a moment.',
    },
  },
};

let turnstileReady;
const loadTurnstile = () => turnstileReady ??= new Promise((resolve, reject) => {
  if (window.turnstile) return resolve(window.turnstile);
  const script = Object.assign(document.createElement('script'), { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' });
  script.onload = () => resolve(window.turnstile);
  script.onerror = reject;
  document.head.append(script);
});

// Reactions this browser has given, so a click toggles instead of piling up. Per-viewer convenience only.
const reactedKey = 'iseul-reacted';
const reacted = () => { try { return new Set(JSON.parse(localStorage.getItem(reactedKey) ?? '[]')); } catch { return new Set(); } };
const saveReacted = set => { try { localStorage.setItem(reactedKey, JSON.stringify([...set])); } catch {} };

// reactions: emoji to offer (any single emoji works with the server); [] hides reactions.
// anonymous: false makes the name required. secret: true offers "visible to the site admin only".
// These shape the form only; the server accepts any of them.
export function mount(target, { siteKey, endpoint = '/api/comments', slug = location.pathname, lang = 'ko', reactions = ['👍', '❤️', '😂', '😮', '😢'], anonymous = true, secret = false } = {}) {
  const t = strings[lang] ?? strings.en;
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  const client = createClient(endpoint);
  const day = iso => new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  const message = error => t.errors[error.code] ?? t.errors.other;
  let replyTo = null;

  root.classList.add('iseul');
  root.innerHTML = `<h2>${t.title} <span class="count"></span></h2><ol></ol><form class="new">
    <p class="replying" hidden><span></span> <button type="button" class="link">${t.cancel}</button></p>
    <div class="row">
      <label>${t.name} <input name="name" maxlength="40" ${anonymous ? `placeholder="${t.anonymous}"` : 'required'} autocomplete="nickname"></label>
      <label>${t.password} <input name="password" type="password" required minlength="4" maxlength="100" autocomplete="new-password"></label>
      <label>${t.keep} <select name="keep">${Object.entries(t.keeps).map(([value, label]) => `<option value="${value}"${value === 'forever' ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    </div>
    <label>${t.body} <textarea name="body" required maxlength="2000" rows="4"></textarea></label>
    ${secret ? `<label class="check"><input type="checkbox" name="secret"> ${t.secretLabel}</label>` : ''}
    <p class="note">${t.note}</p>
    <div class="turnstile"></div>
    <button type="submit">${t.submit}</button>
    <p class="status" role="status" aria-live="polite"></p>
  </form>`;
  const list = root.querySelector('ol'), form = root.querySelector('form'), status = form.querySelector('.status'), button = form.querySelector('button[type=submit]');
  const replying = form.querySelector('.replying');

  function setReply(comment) {
    replyTo = comment;
    replying.hidden = !comment;
    button.textContent = comment ? t.submitReply : t.submit;
    if (comment) {
      replying.querySelector('span').textContent = `↪ ${t.replyingTo(comment.name || t.anonymous)}`;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.body.focus({ preventScroll: true });
    }
  }
  replying.querySelector('button').addEventListener('click', () => setReply(null));

  // One Turnstile widget (in the new-comment form) supplies a fresh token for every write; reset after each use.
  const widget = loadTurnstile().then(ts => ({ ts, id: ts.render(root.querySelector('.turnstile'), { sitekey: siteKey }) }));
  async function send(action, data) {
    const { ts, id } = await widget;
    try { await action({ ...data, turnstile: ts.getResponse(id) ?? '' }); } finally { ts.reset(id); }
  }

  function manage(li, comment, mode) {
    li.querySelector(':scope > .manage')?.remove();
    const panel = document.createElement('form');
    panel.className = 'manage';
    panel.innerHTML = (mode === 'edit' ? `<label>${t.body} <textarea required maxlength="2000" rows="4"></textarea></label>` : `<p>${t.confirm}</p>`)
      + `<label>${t.password} <input type="password" required autocomplete="current-password"></label><div class="actions"><button type="submit">${mode === 'edit' ? t.save : t.remove}</button><button type="button" class="secondary">${t.cancel}</button></div><p class="status" role="status" aria-live="polite"></p>`;
    const textarea = panel.querySelector('textarea'), submit = panel.querySelector('button[type=submit]');
    if (textarea) textarea.value = comment.body;
    panel.querySelector('.secondary').addEventListener('click', () => panel.remove());
    panel.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const password = panel.querySelector('input').value;
        await send(mode === 'edit' ? client.edit : client.remove, mode === 'edit' ? { id: comment.id, password, body: textarea.value } : { id: comment.id, password });
        await load();
      } catch (error) {
        panel.querySelector('.status').textContent = message(error);
        submit.disabled = false;
      }
    });
    (li.querySelector(':scope > .reactions') ?? li.querySelector(':scope > .body')).after(panel);
    (textarea ?? panel.querySelector('input')).focus();
  }

  function reactionBar(comment) {
    const bar = document.createElement('p');
    bar.className = 'reactions';
    for (const e of reactions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'reaction';
      b.setAttribute('aria-label', t.react(e));
      const paint = count => {
        b.textContent = count ? `${e} ${count}` : e;
        b.classList.toggle('counted', count > 0);
        b.setAttribute('aria-pressed', String(reacted().has(`${comment.id}:${e}`)));
      };
      paint(comment.reactions[e] ?? 0);
      b.addEventListener('click', async () => {
        const set = reacted(), id = `${comment.id}:${e}`, on = !set.has(id);
        b.disabled = true;
        try {
          const { reactions } = await client.react({ id: comment.id, emoji: e, on });
          on ? set.add(id) : set.delete(id);
          saveReacted(set);
          paint(reactions[e] ?? 0);
        } catch (error) { status.textContent = message(error); } finally { b.disabled = false; }
      });
      bar.append(b);
    }
    return bar;
  }

  function render(comment) {
    const li = document.createElement('li');
    li.innerHTML = `<p class="meta"><strong></strong> <time></time></p><p class="body"></p>`;
    const meta = li.querySelector('.meta');
    // A secret comment arrives without name, body, or reactions: show a placeholder, and only its author's delete.
    meta.querySelector('strong').textContent = comment.secret ? '' : comment.name || (comment.admin ? '' : t.anonymous);
    if (comment.admin && !comment.secret) meta.querySelector('strong').insertAdjacentHTML('afterend', ` <span class="badge">${t.operator}</span>`);
    const time = meta.querySelector('time');
    time.textContent = day(comment.created_at) + (comment.expires_at ? ` · ${t.until(day(comment.expires_at))}` : '');
    time.setAttribute('datetime', comment.created_at);
    const actions = [];
    if (comment.parent_id == null && !comment.secret) actions.push([t.reply, () => setReply(comment)]);
    if (!comment.admin && !comment.secret) actions.push([t.edit, () => manage(li, comment, 'edit')]);
    if (!comment.admin) actions.push([t.remove, () => manage(li, comment, 'delete')]);
    for (const [label, act] of actions) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: label });
      b.addEventListener('click', act);
      meta.append(' ', b);
    }
    if (comment.secret) Object.assign(li.querySelector('.body'), { className: 'body secret', textContent: t.secretText });
    else linkify(li.querySelector('.body'), comment.body);
    if (reactions.length && !comment.secret) li.append(reactionBar(comment));
    return li;
  }

  async function load() {
    try {
      const comments = await client.list(slug);
      root.querySelector('.count').textContent = comments.length || '';
      const items = new Map(comments.filter(c => c.parent_id == null).map(c => [c.id, render(c)]));
      for (const c of comments.filter(c => c.parent_id != null)) {
        const parent = items.get(c.parent_id);
        if (!parent) continue;
        let replies = parent.querySelector(':scope > ol.replies');
        if (!replies) parent.append(replies = Object.assign(document.createElement('ol'), { className: 'replies' }));
        replies.append(render(c));
      }
      list.replaceChildren(...items.values());
      if (replyTo && !items.has(replyTo.id)) setReply(null);
    } catch { status.textContent = t.loadFailed; }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = t.sending;
    try {
      await send(client.post, { slug, ...Object.fromEntries(new FormData(form)), secret: form.secret?.checked === true, ...(replyTo && { parent: replyTo.id }) });
      form.reset();
      setReply(null);
      status.textContent = t.sent;
      await load();
    } catch (error) {
      status.textContent = message(error);
    } finally {
      button.disabled = false;
    }
  });
  load();
}
