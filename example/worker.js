// Local demo: see README "Development".
import { createHandler } from '../src/server.js';

const comments = createHandler();
export default {
  fetch: (request, env) => new URL(request.url).pathname === '/api/comments' ? comments(request, env) : env.ASSETS.fetch(request),
};
