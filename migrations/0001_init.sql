-- D1 migration. Apply with `wrangler d1 migrations apply DB` (migrations_dir: node_modules/iseul/migrations)
-- or by hand with `wrangler d1 execute <database> --remote --file <file>` for each file in order (0001, 0002, ...).
-- Pick one way and keep it: `migrations apply` does not know about files run by hand and would run them again.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL, -- empty means anonymous
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT, -- ISO time; NULL keeps forever
  password_hash TEXT, -- base64 salt$PBKDF2-SHA256 hash; NULL for admin comments
  parent_id INTEGER, -- top-level comment this replies to
  admin INTEGER NOT NULL DEFAULT 0, -- 1 when written from the admin side
  reactions TEXT, -- JSON counts, e.g. {"👍":2}
  deleted_at TEXT, -- set when deleted; rows are never removed
  deleted_by TEXT, -- author | admin
  secret INTEGER NOT NULL DEFAULT 0 -- 1: only the admin side sees name and body
);
CREATE INDEX IF NOT EXISTS comments_slug ON comments (slug, id);
-- Nothing is ever DELETEd: expired and deleted comments stay as a record for the admin side.
