// iseul/embed: the widget for pages without a bundler, served by an iseul Worker next to its API.
//   <div class="iseul-comments" data-site-key="<turnstile site key>"></div>
//   <script type="module" src="https://<your worker>/embed.js"></script>
// Optional attributes: data-lang (ko|en), data-slug (default: the page path), data-secret="true",
// data-anonymous="false", data-reactions="👍 ❤️" ("" hides reactions), data-quote="<article selector>" (quote comments),
// data-quote-marks="true" | "right" | "left". The page's origin must be in the Worker's ALLOWED_ORIGINS.
import { mount } from './widget.js';

document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('widget.css', import.meta.url).href }));
for (const el of document.querySelectorAll('.iseul-comments')) {
  const { siteKey, lang, slug, secret, anonymous, reactions, quote, quoteMarks } = el.dataset;
  mount(el, {
    siteKey, endpoint: new URL('/api/comments', import.meta.url).href,
    ...(lang && { lang }), ...(slug && { slug }), ...(reactions !== undefined && { reactions: reactions.split(/\s+/).filter(Boolean) }),
    secret: secret === 'true', anonymous: anonymous !== 'false',
    ...(quote && { quote }), ...(quoteMarks && { quoteMarks: quoteMarks === 'left' ? 'left' : quoteMarks !== 'false' }),
  });
}
