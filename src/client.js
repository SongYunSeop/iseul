// iseul/client: browser (or any fetch runtime) client for a iseul/server endpoint.
// Failed calls throw an Error whose `code` is the server's error code ('network' when there is no JSON reply).
export function createClient(endpoint = '/api/comments', { token, credentials } = {}) {
  async function call(method, query = '', data) {
    const headers = { ...(data && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) };
    const res = await fetch(endpoint + query, { method, headers, credentials, body: data && JSON.stringify(data) });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(result.error ?? 'network'), { code: result.error ?? 'network', status: res.status });
    return result;
  }
  return {
    list: slug => call('GET', `?slug=${encodeURIComponent(slug)}`),
    // { slug, name, body, password, keep: 'day'|'week'|'month'|'year'|'forever', turnstile, parent?, secret? }.
    // With parent it is a reply; secret: true shows it to the admin side only (the public list gets a placeholder).
    post: comment => call('POST', '', comment),
    // Adds (on: true) or removes (on: false) one reaction; resolves to { reactions }.
    react: ({ id, emoji, on = true }) => call('POST', '?react', { id, emoji, on }),
    // { id, password, body, turnstile }
    edit: change => call('PUT', '', change),
    // { id, password, turnstile }
    remove: target => call('DELETE', '', target),
    admin: {
      // { slug, q, status }: one page, a name/body search, and/or one state (live, expired, deleted); latest 200 either way.
      list: ({ slug = '', q = '', status = '' } = {}) => call('GET', `?admin&slug=${encodeURIComponent(slug)}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`),
      // [{ slug, count }], most recently commented first.
      pages: () => call('GET', '?admin&pages'),
      // Every comment, oldest first, for backups.
      export: () => call('GET', '?admin&export'),
      // Admin comment: { parent, name, body } for a reply or { slug, name, body } for a new thread.
      post: comment => call('POST', '?admin', comment),
      // One id or an array of up to 200; hides them (and replies of top-level ones), the record stays.
      remove: ids => call('DELETE', `?admin${[].concat(ids).map(id => `&id=${encodeURIComponent(id)}`).join('')}`),
    },
  };
}
