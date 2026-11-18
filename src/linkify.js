// Fills el with text, turning http(s) URLs into nofollow links. Trailing punctuation stays outside the link.
export function linkify(el, text) {
  el.replaceChildren(...text.split(/(https?:\/\/[^\s<>"']+)/g).flatMap((part, i) => {
    if (i % 2 === 0) return part ? [part] : [];
    const url = part.replace(/[.,!?;:)\]}'"]+$/, '');
    const a = Object.assign(document.createElement('a'), { href: url, textContent: url, rel: 'nofollow ugc noopener', target: '_blank' });
    return [a, part.slice(url.length)];
  }));
}
