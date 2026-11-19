// iseul/widget: default comment UI built on iseul/client. Style it with iseul/widget.css.
import { createClient } from './client.js';
import { linkify } from './linkify.js';
import { quoteFrom, findQuote, quoteFinder } from './quote.js';

const strings = {
  ko: {
    title: '댓글', name: '닉네임', anonymous: '익명', secretLabel: '관리자에게만 보이기', secretText: '비밀 댓글입니다.', quoteButton: '인용해서 댓글', quoteRemove: '인용 빼기', quoteMissing: '본문에서 이 문장을 찾을 수 없어요. 글이 바뀌었을 수 있어요.', quoteGone: '본문에 없는 문장', quoteTooLong: '300자까지 인용할 수 있어요', quoteMarkLabel: (n, q) => `${q}에 달린 댓글 ${n}개`, quoteList: '인용 댓글', quoteJump: '본문에서 보기', quoteReady: '선택한 문장을 인용해서 댓글을 쓸 수 있어요. 본문 바로 뒤의 버튼을 누르세요.', password: '비밀번호', keep: '남길 기간', body: '내용', operator: '운영자',
    keeps: { day: '하루', week: '일주일', month: '한 달', year: '일 년', forever: '영원히' },
    note: '기간이 지나면 댓글이 사라집니다. 비밀번호는 댓글을 고치거나 지울 때 필요합니다.',
    submit: '댓글 남기기', submitReply: '답글 남기기', sending: '등록하고 있습니다.', sent: '댓글을 남겼습니다.', loadFailed: '댓글을 불러오지 못했습니다.',
    reply: '답글', replyingTo: name => `${name}님에게 답글`, react: e => `${e} 반응`,
    edit: '수정', remove: '삭제', save: '저장', cancel: '취소', confirm: '이 댓글을 지울까요? 달린 답글도 함께 화면에서 사라집니다.', until: day => `${day}까지 남아요`,
    errors: {
      name: '닉네임은 40자 이하로 입력해 주세요.', body: '내용은 1~2,000자로 입력해 주세요.', password: '비밀번호는 4~100자로 입력해 주세요.',
      keep: '남길 기간을 선택해 주세요.', page: '댓글을 달 수 없는 글입니다.', turnstile: '자동 등록 방지 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      quote: '인용은 300자까지 할 수 있습니다.', not_found: '댓글을 찾을 수 없습니다. 이미 사라졌을 수 있어요.', wrong_password: '비밀번호가 맞지 않습니다.', rate: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      other: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
  },
  en: {
    title: 'Comments', name: 'Name', anonymous: 'Anonymous', secretLabel: 'Visible to the site admin only', secretText: 'A private comment.', quoteButton: 'Quote in a comment', quoteRemove: 'Remove quote', quoteMissing: 'This passage is no longer on the page.', quoteGone: 'not on the page', quoteTooLong: 'Quotes can be up to 300 characters', quoteMarkLabel: (n, q) => `${n} comment${n > 1 ? 's' : ''} on ${q}`, quoteList: 'Quote comments', quoteJump: 'Show in the article', quoteReady: 'You can quote the selection in a comment; the button is right after the article.', password: 'Password', keep: 'Keep for', body: 'Comment', operator: 'Author',
    keeps: { day: 'A day', week: 'A week', month: 'A month', year: 'A year', forever: 'Forever' },
    note: 'Comments disappear when their time is up. The password lets you edit or delete your comment.',
    submit: 'Post comment', submitReply: 'Post reply', sending: 'Posting…', sent: 'Your comment is up.', loadFailed: 'Could not load comments.',
    reply: 'Reply', replyingTo: name => `Replying to ${name}`, react: e => `React with ${e}`,
    edit: 'Edit', remove: 'Delete', save: 'Save', cancel: 'Cancel', confirm: 'Delete this comment? Its replies disappear from the page too.', until: day => `stays until ${day}`,
    errors: {
      name: 'Names can be up to 40 characters.', body: 'Comments must be 1 to 2,000 characters.', password: 'Passwords must be 4 to 100 characters.',
      keep: 'Choose how long to keep the comment.', page: 'Comments are closed on this page.', turnstile: 'The bot check failed. Please try again in a moment.',
      quote: 'Quotes can be up to 300 characters.', not_found: 'That comment is gone.', wrong_password: 'Wrong password.', rate: 'Too many requests. Please wait a moment.',
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
// quote: the article element (or its selector). Selecting text in it offers "quote in a comment"; off by default.
// quoteMarks: with quote, also highlight quoted passages and put count badges in the article's margin ('right', the
// default for true, or 'left'; only when there is room). The comment list stays the source of truth; passages that are
// gone are simply not marked.
// These shape the form only; the server accepts any of them.
// Returns unmount(): removes the widget and everything it added to the page (for pages that mount again without reloading).
export function mount(target, { siteKey, endpoint = '/api/comments', slug = location.pathname, lang = 'ko', reactions = ['👍', '❤️', '😂', '😮', '😢'], anonymous = true, secret = false, quote, quoteMarks = false } = {}) {
  const t = strings[lang] ?? strings.en;
  // Everything added outside the widget (listeners, the layer, highlights) is undone by unmount().
  const off = new AbortController(), { signal } = off;
  let gone = false, observer = null;
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  const client = createClient(endpoint);
  const day = iso => new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  const message = error => t.errors[error.code] ?? t.errors.other;
  let replyTo = null, quoting = null;
  let article = null;
  if (quote) {
    try { article = typeof quote === 'string' ? document.querySelector(quote) : quote; } catch {}
    // Passages are looked up in the article's text, so an article holding the comments would match their own quotes.
    if (!article) console.warn(`iseul: no element for quote: ${quote}; quote comments are off.`);
    else if (article.contains(root)) { console.warn('iseul: the `quote` element must not contain the comments; quote comments are off.'); article = null; }
  }
  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const center = box => scrollBy({ top: box.top + box.height / 2 - innerHeight / 2, behavior: smooth() });
  const canHighlight = Boolean(globalThis.CSS?.highlights && globalThis.Highlight);
  const canPop = Boolean(HTMLElement.prototype.showPopover);
  // What iseul draws outside the widget (quote button, badges, popovers) sits in one zero-size layer at the top left of its
  // containing block; positions are taken relative to it, so a positioned or offset body does not shift them. It comes
  // right after the article, so the quote button and badges are next in the tab order after the text they belong to.
  const layer = article ? Object.assign(document.createElement('div'), { className: 'iseul-quote-marks' }) : null;
  const announce = Object.assign(document.createElement('p'), { className: 'iseul-sr' });
  announce.setAttribute('role', 'status');
  layer?.append(announce);
  if (layer) article.after(layer);
  const place = (el, x, y) => { const o = layer.getBoundingClientRect(); Object.assign(el.style, { left: `${x - o.left}px`, top: `${y - o.top}px` }); };

  root.classList.add('iseul');
  root.innerHTML = `<h2>${t.title} <span class="count"></span></h2><ol></ol><form class="new">
    <p class="replying" hidden><span></span> <button type="button" class="link">${t.cancel}</button></p>
    <div class="quoting" hidden><blockquote></blockquote><button type="button" class="link">${t.quoteRemove}</button></div>
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
      form.scrollIntoView({ behavior: smooth(), block: 'center' });
      form.body.focus({ preventScroll: true });
    }
  }
  replying.querySelector('button').addEventListener('click', () => setReply(null));

  const quotingBox = form.querySelector('.quoting');
  function setQuote(q) {
    quoting = q;
    quotingBox.hidden = !q;
    if (!q) return;
    quotingBox.querySelector('blockquote').textContent = q.text;
    form.scrollIntoView({ behavior: smooth(), block: 'center' });
    form.body.focus({ preventScroll: true });
  }
  quotingBox.querySelector('button').addEventListener('click', () => setQuote(null));

  // With `quote`, selecting text in the article shows a small button above the selection.
  let quiet = false;
  if (article) {
    const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'iseul-quote-pick', textContent: t.quoteButton, hidden: true });
    layer.append(pick);
    let picked = null, timer;
    const update = () => {
      const selection = getSelection(), range = selection.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null;
      const was = !pick.hidden;
      picked = quiet ? null : range && quoteFrom(article, range);
      quiet = false;
      pick.hidden = !picked;
      announce.textContent = picked && !picked.tooLong && !was ? t.quoteReady : '';
      if (!picked) return;
      paint();
      // A selection that is too long shows why instead of silently offering nothing.
      pick.disabled = Boolean(picked.tooLong);
      pick.textContent = picked.tooLong ? t.quoteTooLong : t.quoteButton;
      // Touch screens put their own copy menu above a selection, so there (and at the top of the screen) the button goes
      // below it; on touch it is also larger.
      const touch = matchMedia('(pointer: coarse)').matches, rects = range.getClientRects(), box = range.getBoundingClientRect();
      const below = touch || box.top < 48, edge = below ? rects[rects.length - 1] ?? box : box, width = document.documentElement.clientWidth;
      pick.classList.toggle('below', below);
      pick.classList.toggle('touch', touch);
      place(pick, Math.min(Math.max(edge.left + edge.width / 2, 80), width - 80), below ? edge.bottom + 14 : box.top - 8);
    };
    document.addEventListener('selectionchange', () => { clearTimeout(timer); timer = setTimeout(update, 250); }, { signal });
    signal.addEventListener('abort', () => clearTimeout(timer));
    pick.addEventListener('pointerdown', event => event.preventDefault()); // keep the selection while clicking
    pick.addEventListener('click', () => { if (picked?.tooLong) return; setQuote(picked); getSelection().removeAllRanges(); pick.hidden = true; });
  }

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

  // Colors for what iseul draws outside the widget (badges, highlights, popovers, the quote button), taken from the widget
  // so they follow the site's theme. Set on .iseul: --iseul-quote-color (default --iseul-accent), --iseul-quote-ink (badge
  // text, default white), --iseul-quote-surface (popover background, default the background behind the widget); popover
  // text uses the widget's text color. Read again whenever something shows, so a theme switch is picked up.
  function paint() {
    const style = getComputedStyle(root), get = name => style.getPropertyValue(name).trim();
    let surface = get('--iseul-quote-surface');
    for (let el = root; !surface && el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') surface = bg;
    }
    const accent = get('--iseul-quote-color') || get('--iseul-accent');
    article.style.setProperty('--iseul-quote-accent', accent);
    for (const [name, value] of [['--iseul-quote-accent', accent], ['--iseul-quote-ink', get('--iseul-quote-ink') || '#fff'], ['--iseul-quote-surface', surface || 'Canvas'], ['--iseul-quote-text', style.color]]) layer.style.setProperty(name, value);
  }
  // Briefly marks a passage without selecting it (a selection would pop up the copy menu on phones).
  let flashTimer;
  function flashPassage(range) {
    if (!canHighlight) {
      quiet = true;
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    paint();
    const highlight = new Highlight(range);
    highlight.priority = 1;
    CSS.highlights.set('iseul-quote-focus', highlight);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => CSS.highlights.delete('iseul-quote-focus'), 2200);
  }

  // A quoted passage above a comment: clicking it scrolls to the passage and briefly marks it. One that is not on the page
  // (edited away, or never there) is plain text that says so instead of passing for a real quote.
  function quoteBlock(q) {
    if (!findQuote(article, q)) {
      const block = Object.assign(document.createElement('blockquote'), { className: 'quote missing', title: t.quoteMissing, textContent: q.text });
      block.append(Object.assign(document.createElement('small'), { textContent: ` (${t.quoteGone})` }));
      return block;
    }
    const block = Object.assign(document.createElement('button'), { type: 'button', className: 'link quote', textContent: q.text });
    block.setAttribute('aria-label', `${t.quoteJump}: ${q.text}`);
    block.addEventListener('click', () => {
      const range = findQuote(article, q);
      if (!range) return;
      // A passage in a closed <details> is opened first, or the jump would land on nothing.
      for (let d = range.startContainer.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
      center(range.getBoundingClientRect());
      flashPassage(range);
    });
    return block;
  }

  function render(comment) {
    const li = document.createElement('li');
    li.dataset.id = comment.id;
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
    if (comment.quote && article) li.querySelector('.body').before(quoteBlock(comment.quote));
    if (comment.secret) Object.assign(li.querySelector('.body'), { className: 'body secret', textContent: t.secretText });
    else linkify(li.querySelector('.body'), comment.body);
    if (reactions.length && !comment.secret) li.append(reactionBar(comment));
    return li;
  }

  const marks = Boolean(article && quoteMarks);
  let quoted = [], found = [], stale = false;
  function jumpTo(comment) {
    const li = root.querySelector(`li[data-id="${comment.id}"]`);
    if (!li) return;
    // A tall thread shows its top; keyboard and screen-reader users land on the comment itself.
    li.scrollIntoView({ behavior: smooth(), block: li.offsetHeight > innerHeight ? 'start' : 'center' });
    li.tabIndex = -1;
    li.focus({ preventScroll: true });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1600);
  }
  // The line boxes of a passage's text (a range's own rects also cover whole elements inside it, such as images).
  function textRects(range) {
    const common = range.commonAncestorContainer;
    if (common.nodeType === Node.TEXT_NODE) return [...range.getClientRects()].filter(r => r.width && r.height);
    const rects = [], walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      rects.push(...[...part.getClientRects()].filter(r => r.width && r.height));
    }
    return rects;
  }
  // Highlighted passages under a point (highlights are painted, not elements, so hit-test against their text's line boxes).
  const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const quotedAt = (x, y) => found.filter(f => inside(f.range.getBoundingClientRect(), x, y) && textRects(f.range).some(r => inside(r, x, y)));
  if (marks) {
    const again = () => requestAnimationFrame(placeMarks);
    addEventListener('resize', again, { signal });
    // Images loading, fonts, and anything above the article moving it (body size changes) re-place the badges.
    observer = new ResizeObserver(again);
    observer.observe(article);
    observer.observe(document.body);
  }
  if (marks && canHighlight) {
    // Clicking a highlighted passage shows its comments right there. Links, controls, text selection and double clicks keep
    // working, and a click while that list is open only closes it.
    let wasOpen = false;
    const openPassage = () => (canPop ? layer.querySelector('.iseul-quote-list.full:popover-open') : null);
    article.addEventListener('pointerdown', () => { wasOpen = Boolean(openPassage()); }, { signal });
    article.addEventListener('click', event => {
      if (event.detail > 1) return openPassage()?.hidePopover();
      if (wasOpen || event.target.closest('a, button, summary, label, input, select, textarea, [role=button]') || !getSelection().isCollapsed) return;
      const hits = quotedAt(event.clientX, event.clientY);
      if (!hits.length) return;
      if (!canPop) return jumpTo(hits[0].comment);
      const line = textRects(hits[0].range).find(r => event.clientY >= r.top && event.clientY <= r.bottom) ?? hits[0].range.getBoundingClientRect();
      layer.querySelector('.iseul-quote-list.full')?.remove();
      const list = popoverList(hits.map(f => f.comment), true);
      position(list, line);
      paint();
      list.showPopover();
    }, { signal });
    let frame;
    article.addEventListener('mousemove', event => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { article.style.cursor = quotedAt(event.clientX, event.clientY).length ? 'pointer' : ''; });
    }, { signal });
  }
  // A popover of comments: a badge's (the comments on its line, opened by the badge as its popovertarget, which also
  // gives toggling, aria-expanded and focus return) or a tapped passage's (full = whole text). Picking one scrolls to it.
  function popoverList(comments, full = false) {
    const list = Object.assign(document.createElement('div'), { className: `iseul-quote-list${full ? ' full' : ''}`, popover: 'auto' });
    for (const comment of comments) {
      const item = document.createElement('button');
      item.type = 'button';
      item.innerHTML = '<b></b><q></q><span></span>';
      item.querySelector('b').textContent = comment.name || (comment.admin ? t.operator : t.anonymous);
      item.querySelector('q').textContent = comment.quote.text;
      item.querySelector('span').textContent = comment.body;
      item.addEventListener('click', () => { list.hidePopover(); jumpTo(comment); });
      list.append(item);
    }
    list.firstChild.autofocus = true; // keyboard users land in the list
    list.setAttribute('aria-label', t.quoteList);
    // Badges are not rebuilt under an open list; a rebuild that was asked for meanwhile runs once it closes.
    list.addEventListener('toggle', event => { if (event.newState === 'closed' && stale) { stale = false; requestAnimationFrame(placeMarks); } });
    layer.append(list);
    return list;
  }
  // Toward the page from the anchor: from its left edge (or ending at its right edge), on the side with more room, no
  // taller than that room. Page coordinates (position: absolute in the top layer), so the list scrolls with the page.
  // Widths match the stylesheet, so nothing is measured before the list shows.
  function position(list, box, end = false) {
    const width = Math.min(list.classList.contains('full') ? 340 : 280, innerWidth - 16);
    const left = end ? box.right - width : Math.min(box.left, document.documentElement.clientWidth - width - 8);
    const below = innerHeight - box.bottom >= box.top, room = (below ? innerHeight - box.bottom : box.top) - 14;
    Object.assign(list.style, {
      left: `${Math.max(8, left) + scrollX}px`, maxHeight: `${Math.min(room, innerHeight / 2)}px`,
      top: below ? `${box.bottom + 6 + scrollY}px` : 'auto', bottom: below ? 'auto' : `${document.documentElement.clientHeight - box.top + 6 - scrollY}px`,
    });
  }
  function placeMarks() {
    if (!marks || gone) return;
    if (canPop && layer.querySelector('.iseul-quote-list:popover-open')) return void (stale = true);
    // Passages not shown (inside a closed <details>, display: none) get no badge and no click; such text can still report a
    // line box. Opening them resizes the article, which places them again.
    const find = quoteFinder(article);
    found = quoted.map(comment => ({ comment, range: find(comment.quote) }))
      .filter(f => f.range && f.range.startContainer.parentElement?.checkVisibility?.({ visibilityProperty: true }) !== false);
    if (canHighlight) CSS.highlights.set('iseul-quote', new Highlight(...found.map(f => f.range)));
    layer.querySelectorAll('.iseul-quote-mark, .iseul-quote-list').forEach(el => el.remove());
    paint();
    const box = article.getBoundingClientRect(), right = quoteMarks !== 'left';
    if ((right ? document.documentElement.clientWidth - box.right : box.left) < 56) return; // no room in the margin: highlights and the list only
    const rows = new Map(); // passages on (about) the same line share one badge
    for (const { comment, range } of found) {
      const first = textRects(range)[0];
      if (!first) continue;
      const top = Math.round(first.top);
      const row = [...rows.keys()].find(y => Math.abs(y - top) < 12) ?? top;
      rows.set(row, [...(rows.get(row) ?? []), comment]);
    }
    for (const [top, comments] of rows) {
      const mark = Object.assign(document.createElement('button'), { type: 'button', className: `iseul-quote-mark ${right ? 'right' : 'left'}`, textContent: `💬 ${comments.length}` });
      const passages = [...new Set(comments.map(c => c.quote.text))].map(q => `“${q.length > 40 ? `${q.slice(0, 40)}…` : q}”`);
      mark.setAttribute('aria-label', t.quoteMarkLabel(comments.length, passages.join(', ')));
      place(mark, right ? box.right + 8 : box.left - 12, top);
      if (canPop) {
        const list = popoverList(comments);
        mark.popoverTargetElement = list;
        list.addEventListener('beforetoggle', event => { if (event.newState === 'open') { paint(); position(list, mark.getBoundingClientRect(), !right); } });
      } else mark.addEventListener('click', () => jumpTo(comments[0]));
      layer.append(mark);
    }
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
      quoted = comments.filter(c => c.quote && !c.secret);
      placeMarks();
    } catch { status.textContent = t.loadFailed; }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = t.sending;
    try {
      await send(client.post, { slug, ...Object.fromEntries(new FormData(form)), secret: form.secret?.checked === true, ...(replyTo && { parent: replyTo.id }), ...(quoting && { quote: quoting }) });
      form.reset();
      setReply(null);
      setQuote(null);
      status.textContent = t.sent;
      await load();
    } catch (error) {
      status.textContent = message(error);
    } finally {
      button.disabled = false;
    }
  });
  load();
  return function unmount() {
    gone = true;
    off.abort();
    observer?.disconnect();
    layer?.remove();
    if (article) article.style.cursor = '';
    if (canHighlight && article) { CSS.highlights.delete('iseul-quote'); CSS.highlights.delete('iseul-quote-focus'); }
    widget.then(({ ts, id }) => ts.remove?.(id)).catch(() => {});
    root.replaceChildren();
    root.classList.remove('iseul');
  };
}
