# iseul

로그인 없이 쓰고, 때가 되면 사라지는 댓글. 작성자가 댓글을 화면에 남길 기간(하루·일주일·한 달·일 년·영원히)을 직접 고릅니다. Cloudflare Workers 또는 Pages Functions + D1 + Turnstile로 무료 구간에서 돌아갑니다.

[데모](https://songyunseop.github.io/iseul/) · [English](README.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SongYunSeop/iseul/tree/main/template)

`iseul`은 "이슬"입니다. 잠시 맺혔다가 때가 되면 사라집니다.

## 기능

- **사라지는 댓글.** 정한 기간이 지나면 화면에서 사라집니다. 답글은 원래 댓글보다 오래 남지 않습니다.
- **계정 없음.** 닉네임은 선택입니다. 작성 때 정한 비밀번호로 나중에 고치거나 지웁니다. 비밀번호는 salt를 넣은 PBKDF2 해시로만 저장합니다.
- **최소한의 데이터, 기록은 운영자에게.** IP·이메일·추적 없음. 만료되거나 지운 댓글은 화면에서 사라지지만 운영자의 DB에는 남습니다.
- **비밀 댓글.** 켜 두면 작성자가 운영자에게만 보이는 댓글을 남길 수 있습니다. 공개 화면에는 자리만 표시됩니다.
- **답글과 반응.** 한 단계 답글, 이모지 반응(기본 👍 ❤️ 😂 😮 😢, 직접 정할 수 있음), 배지가 붙는 운영자 답글.
- **관리 화면.** 페이지·상태별 보기, 검색, 일괄 삭제, 운영자 답글, JSON·CSV 내보내기.
- **알림.** Slack·Discord 등으로 보내는 웹훅(선택).
- **작음.** 의존성 없음. 위젯은 gzip 기준 약 8KB, 한국어·영어 지원.

진입점은 다섯 가지입니다: `iseul/server`(API 핸들러), `iseul/client`(직접 만드는 UI용 fetch 래퍼), `iseul/widget`(기본 댓글 화면), `iseul/admin`(관리 화면), `iseul/embed`(번들러 없는 페이지용 script 태그).

## Deploy to Cloudflare

위 버튼은 [`template/`](template)를 배포합니다. API, `/admin` 관리 화면, 사이트에 붙일 `embed.js`를 Worker 하나로 제공합니다. 먼저 [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) 위젯을 만들고, 배포 화면에서 비밀 키, `ADMIN_TOKEN`, `ALLOWED_ORIGINS`(댓글을 붙일 사이트)를 입력합니다. D1 DB는 자동으로 만들어지고 마이그레이션됩니다. 그다음 페이지에 두 줄을 넣습니다.

```html
<div class="iseul-comments" data-site-key="<Turnstile 사이트 키>"></div>
<script type="module" src="https://<내 worker>.workers.dev/embed.js"></script>
```

선택 속성: `data-slug`, `data-secret="true"`, `data-anonymous="false"`, `data-reactions="👍 ❤️"`. 자세한 내용은 [template/README.md](template/README.md).

이미 있는 Worker나 Pages 프로젝트에 붙이려면 아래 시작하기를 따르세요.

## 시작하기 (내 프로젝트에 붙이기)

### 1. 설치

```sh
npm install github:SongYunSeop/iseul#v0.1.0
```

### 2. Cloudflare 준비

DB를 만들고 `wrangler.toml`에 `DB`로 바인딩하면서 iseul의 마이그레이션 폴더를 지정합니다.

```sh
npx wrangler d1 create comments
```

```toml
[[d1_databases]]
binding = "DB"
database_name = "comments"
database_id = "<d1 create가 알려준 id>"
migrations_dir = "node_modules/iseul/migrations"
```

```sh
npx wrangler d1 migrations apply DB --remote   # iseul을 올린 뒤에도 다시 실행
```

[Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) 위젯을 도메인에 맞게 만듭니다. 사이트 키는 페이지에 쓰고, 비밀 키와 관리자 토큰은 시크릿으로 둡니다.

```sh
npx wrangler secret put TURNSTILE_SECRET   # Pages는 npx wrangler pages secret put ...
npx wrangler secret put ADMIN_TOKEN
```

### 3. API 붙이기

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

### 4. 위젯 붙이기

```js
// 번들러(Vite, Astro, webpack 등) 기준
import { mount } from 'iseul/widget';
import 'iseul/widget.css';

mount('#comments', { siteKey: '<Turnstile 사이트 키>' }); // <div id="comments"></div>
```

| 옵션 | 기본값 | |
| --- | --- | --- |
| `siteKey` | (필수) | Turnstile 사이트 키 |
| `endpoint` | `/api/comments` | API 주소 |
| `slug` | `location.pathname` | 어떤 글의 댓글인지. 여러 사이트가 DB 하나를 쓰면 `location.host + location.pathname` |
| `lang` | `ko` | `ko` 또는 `en` |
| `reactions` | 👍 ❤️ 😂 😮 😢 | 보여 줄 이모지. 서버는 이모지 한 개면 무엇이든 받습니다. `[]`이면 반응 숨김 |
| `anonymous` | `true` | `false`면 닉네임 필수 |
| `secret` | `false` | `true`면 "관리자에게만 보이기" 선택지 표시. 비밀 댓글에 달린 답글도 비밀 |

이 옵션들은 폼 모양만 정합니다. 서버는 어떤 조합이든 받으므로 API를 직접 부르면 익명·비밀 댓글을 남길 수 있습니다.

## 서버

```js
createHandler({
  isAdmin,        // (request, env) => boolean. 기본 tokenAdmin
  canComment,     // (slug, request, env) => boolean. 기본은 300자 이하 모든 slug 허용
  origins,        // API를 부를 수 있는 다른 도메인 목록. 기본 [] (다른 사이트에서 오는 쓰기는 CSRF 방지로 거부)
  webhookContent, // 웹훅 알림에 닉네임·본문 포함. 기본 false
});
```

비밀 댓글(`secret: true`)은 공개 API에 닉네임·내용·반응 없이 나갑니다. 작성자는 비밀번호로 삭제할 수 있습니다.

제한: 닉네임 40자, 내용 1~2,000자, 비밀번호 4~100자. 작성·수정·삭제마다 새 Turnstile 토큰이 필요해서 비밀번호 대입도 막힙니다. 반응에는 필요 없으니 앞단에 속도 제한을 두세요(아래 `RATE_LIMITER` 또는 WAF 속도 제한 규칙). 다른 사이트의 브라우저에서 오는 쓰기는 `origins`에 없으면 거부합니다. 답글은 최상위 댓글에 붙고, 그보다 늦게 만료되지 않으며, 원래 댓글과 함께 숨겨집니다.

선택 env:

| Env | |
| --- | --- |
| `WEBHOOK_URL` | 새 방문자 댓글마다 `{ text, content, comment }`를 POST합니다. Slack은 `text`, Discord는 `content`, 그 밖에는 `comment`를 씁니다. 기본은 어디에 언제까지인지만 보냅니다(`💬 New comment on …/hello/ (fades 2026-11-25)`). `webhookContent: true`면 닉네임과 본문(인용)을 넣습니다. |
| `RATE_LIMITER` | [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 바인딩(Workers 전용, Pages는 API 경로에 WAF 속도 제한 규칙). 작성·수정·삭제·반응을 클라이언트 IP별로 제한합니다. IP는 Cloudflare가 셀 뿐 iseul은 저장하지 않습니다. |

```toml
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 10, period = 60 }
```

## 관리자

같은 주소에 `?admin`을 붙여 요청합니다. 관리자 확인 방식을 고릅니다.

```js
import { createHandler, tokenAdmin, accessAdmin } from 'iseul/server';

createHandler();                         // Authorization: Bearer <ADMIN_TOKEN>
createHandler({ isAdmin: accessAdmin }); // Cloudflare Access JWT. env ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAIL
createHandler({ isAdmin: async (request, env) => await tokenAdmin(request, env) || accessAdmin(request, env) }); // 둘 다, 또는 직접 구현
```

`accessAdmin`은 Cloudflare Access 애플리케이션 뒤의 경로에서만 동작합니다. 그 경로(예: `/admin/api/comments`)에 핸들러를 하나 더 붙이세요.

관리 화면:

```js
import { mountAdmin } from 'iseul/admin';
import 'iseul/widget.css';

mountAdmin('#admin', { endpoint: '/api/comments' }); // <div id="admin"></div>
```

최신 댓글 200개를 보여 주고 페이지와 상태(공개 중·만료·삭제됨)로 거릅니다. 먼저 토큰 없이 서버에 물어보므로 Cloudflare Access나 쿠키 확인은 그대로 동작합니다. 서버가 거부하면 `ADMIN_TOKEN`을 묻고, 그 탭의 `sessionStorage`에만 둡니다.

## 클라이언트

같은 API로 화면을 직접 만들 수 있습니다.

```js
import { createClient } from 'iseul/client';

const comments = createClient('/api/comments');
await comments.list('/posts/hello');
await comments.post({ slug: '/posts/hello', name: '', body: '안녕하세요', password: '1234', keep: 'week', turnstile: token });
await comments.post({ parent: 1, name: '', body: '답글', password: '1234', keep: 'day', turnstile: token });
await comments.react({ id: 1, emoji: '👍' });    // on: false면 취소, { reactions }를 돌려줌
await comments.edit({ id: 1, password: '1234', body: '고친 내용', turnstile: token });
await comments.remove({ id: 1, password: '1234', turnstile: token });

const admin = createClient('/api/comments', { token: '<ADMIN_TOKEN>' });
await admin.admin.list({ slug: '/posts/hello', q: '스팸', status: 'deleted' }); // 모두 선택, 최신 200개
await admin.admin.pages();                        // [{ slug, count }], 최근 댓글 순
await admin.admin.post({ parent: 1, name: '송윤섭', body: '고마워요' }); // 운영자 답글, 비밀번호 없음
await admin.admin.export();                       // 전체 댓글, 오래된 순
await admin.admin.remove([1, 2, 3]);              // id 하나 또는 최대 200개, 답글과 함께
```

`keep`은 `day`, `week`, `month`, `year`, `forever` 중 하나입니다. 댓글에는 `parent_id`, `admin`, `secret`, `reactions`(`{ "👍": 2 }`)가 함께 오고, 관리자 목록에는 `deleted_at`, `deleted_by`도 옵니다. `name`이 비어 있으면 익명입니다.

실패하면 `code`가 붙은 `Error`를 던집니다: `name`, `body`, `password`, `keep`, `slug`, `page`, `turnstile`, `not_found`, `wrong_password`, `rate`, `emoji`, `forbidden`, `request`, `method`, `id`, `network`.

## 스타일

위젯은 주변 글자색을 따릅니다. `.iseul`에서 변수를 바꾸세요.

```css
.iseul { --iseul-ink: #222; --iseul-muted: #777; --iseul-line: #e5e5e5; --iseul-accent: #c33; }
```

## 데이터

댓글 한 줄에는 글 키, 닉네임, 내용, 반응, 시각, 비밀번호 해시가 담깁니다. iseul은 행을 지우지 않습니다. 만료되거나 작성자·관리자가 지운 댓글은 공개 API에서만 숨겨지고, 삭제는 `deleted_at`·`deleted_by`로 기록됩니다. 오래된 기록을 지우려면 D1에 직접 SQL을 실행하세요.

## 개발

```sh
npm test   # Node 22.5 이상 (node:sqlite로 실제 스키마와 SQL 실행)

cd example # 항상 통과하는 Cloudflare Turnstile 테스트 키를 쓰는 로컬 Worker
npx wrangler d1 execute iseul --local --file ../migrations/0001_init.sql
npx wrangler dev   # http://localhost:8787/example/ 와 /example/admin (토큰: dev-admin-token)
```

## 라이선스

MIT
