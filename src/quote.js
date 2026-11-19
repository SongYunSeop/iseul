// Quote helpers for the widget's opt-in `quote` option.
// quoteFrom turns a selection inside the article into { text, prefix, suffix, index }; findQuote finds that passage
// again. The text-only parts (contextAt, locate) are pure so they can be tested without a DOM.
// Whitespace never decides a match: reflowed or minified markup, or a triple click's trailing newline, must not lose a quote.
const CONTEXT = 30, NEAR = 10;
const spaced = s => s.replace(/\s+/g, ' ');
const bare = s => s.replace(/\s+/g, '');

const occurrences = (all, text) => {
  const at = [];
  for (let i = all.indexOf(text); i !== -1; i = all.indexOf(text, i + 1)) at.push(i);
  return at;
};

// The quote for all.slice(start, end): its text (whitespace trimmed and collapsed), up to 30 characters of context on each
// side, and which occurrence it is (capped at the 1000 the server keeps; past that the context alone picks the spot).
export function contextAt(all, start, end) {
  const raw = all.slice(start, end);
  start += raw.length - raw.trimStart().length;
  end = start + raw.trim().length;
  const text = spaced(raw).trim();
  return {
    text,
    prefix: spaced(all.slice(Math.max(0, start - 2 * CONTEXT), start)).slice(-CONTEXT),
    suffix: spaced(all.slice(end, end + 2 * CONTEXT)).slice(0, CONTEXT),
    index: Math.min(occurrences(bare(all), bare(text)).filter(i => i < bare(all.slice(0, start)).length).length, 1000),
  };
}

// all without whitespace, and where each of its characters is in all.
let last = { all: null };
function squash(all) {
  if (last.all === all) return last;
  let out = '';
  const map = [];
  for (let i = 0; i < all.length; i++) if (!/\s/.test(all[i])) { out += all[i]; map.push(i); }
  return (last = { all, out, map });
}

// Where the quoted passage is in `all` now, as { start, end }, or null. The occurrence whose nearby context (10 characters
// on each side) still matches wins, then the remembered occurrence among those. When the quote has context and none of it
// is near any occurrence, the quoted spot was edited away; marking another copy would point at the wrong place.
export function locate(all, { text, prefix = '', suffix = '', index = 0 }) {
  const { out, map } = squash(all), body = bare(text), before = bare(prefix).slice(-NEAR), after = bare(suffix).slice(0, NEAR);
  const hits = body ? occurrences(out, body) : [];
  if (!hits.length) return null;
  // Empty context (a passage at the very start or end) proves nothing, so it scores nothing.
  const score = i => (before && out.slice(0, i).endsWith(before) ? 1 : 0) + (after && out.startsWith(after, i + body.length) ? 1 : 0);
  const best = Math.max(...hits.map(score));
  if (!best && (before || after)) return null;
  const candidates = hits.filter(i => score(i) === best);
  const hit = candidates.includes(hits[index]) ? hits[index] : candidates[0];
  return { start: map[hit], end: map[hit + body.length - 1] + 1 };
}

// The article's text nodes, leaving out code and markup that is not read (script, style, template, noscript).
function texts(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('script, style, template, noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

// Offset of the boundary point (node, offset) in the text of `nodes`.
function offsetOf(nodes, node, offset) {
  const point = document.createRange();
  point.setStart(node, offset);
  let total = 0;
  for (const n of nodes) {
    if (n === node) return total + offset;
    if (point.comparePoint(n, 0) >= 0) return total; // n starts at or after the point
    total += n.data.length;
  }
  return total;
}

// null when the selection is not in root or is empty; { tooLong: true } past 300 characters.
// A selection that runs into root from outside (dragged from the title, or a triple-clicked last paragraph) is cut at root.
export function quoteFrom(root, range) {
  const starts = root.contains(range.startContainer), ends = root.contains(range.endContainer);
  if (!starts && !ends) return null;
  const nodes = texts(root), all = nodes.map(n => n.data).join('');
  const start = starts ? offsetOf(nodes, range.startContainer, range.startOffset) : 0;
  const end = ends ? offsetOf(nodes, range.endContainer, range.endOffset) : all.length;
  const quote = contextAt(all, start, end);
  if (!quote.text) return null;
  return quote.text.length > 300 ? { tooLong: true } : quote;
}

// Finds quotes in root's current text: returns quote => Range | null. Build one per pass over many quotes.
export function quoteFinder(root) {
  const nodes = texts(root), all = nodes.map(n => n.data).join('');
  return quote => {
    const at = locate(all, quote);
    return at && rangeAt(nodes, at.start, at.end);
  };
}
export const findQuote = (root, quote) => quoteFinder(root)(quote);

// A DOM Range over the text of `nodes` from start to end.
function rangeAt(nodes, start, end) {
  const range = document.createRange();
  let offset = 0, started = false;
  for (const node of nodes) {
    const next = offset + node.data.length;
    // `<`: a passage starting exactly where a text node ends belongs to the next node, not the end of this one.
    if (!started && start < next) { range.setStart(node, start - offset); started = true; }
    if (started && end <= next) { range.setEnd(node, end - offset); return range; }
    offset = next;
  }
  return null;
}
