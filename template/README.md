# iseul comments Worker

This Worker runs [iseul](https://github.com/SongYunSeop/iseul): the comments API, a moderation page, and the script other sites embed.

## Before you deploy

Create a [Turnstile widget](https://dash.cloudflare.com/?to=/:account/turnstile). Add the hostnames of the sites that will show comments. Keep its site key and secret key.

## Deploy

During deploy you are asked for:

- `TURNSTILE_SECRET`: the Turnstile secret key.
- `ADMIN_TOKEN`: any long random string, for example `openssl rand -hex 32`.
- `ALLOWED_ORIGINS`: the sites that embed comments, comma separated, for example `https://blog.example.com`.

The D1 database is created and migrated on deploy.

## Embed

On any page of an allowed site:

```html
<div class="iseul-comments" data-site-key="<turnstile site key>" data-lang="en"></div>
<script type="module" src="https://<your worker>.workers.dev/embed.js"></script>
```

Optional attributes: `data-slug` (default: the page path), `data-secret="true"` (offer private comments), `data-anonymous="false"` (require a name), `data-reactions="👍 ❤️"` (`""` hides reactions), `data-quote="article"` (quote comments on the element matching that selector; it must not contain the comments), `data-quote-marks="true"` (highlight quoted passages, badges in the right margin; `"left"` for the left).

## Moderate

Open `https://<your worker>.workers.dev/admin` and enter `ADMIN_TOKEN`.

## Optional

- `WEBHOOK_URL` secret (Settings → Variables and Secrets): Slack or Discord notifications for new comments. Set `WEBHOOK_CONTENT` to `true` to include the name, the quoted passage, and the body.
- Rate limit: `wrangler.jsonc` limits posts, edits, deletes, and reactions to 10 a minute per IP (`RATE_LIMITER`); change `simple` to tune it.
- Upgrade: bump the `iseul` version in `package.json` and push; deploy applies new migrations before the new code goes live.
