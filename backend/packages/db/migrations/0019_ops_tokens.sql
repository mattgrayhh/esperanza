-- 0019_ops_tokens.sql
CREATE TABLE ops_tokens (
  id TEXT PRIMARY KEY,            -- e.g. 'webdev-josh'
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,  -- sha-256 hex of the raw bearer token
  tier TEXT NOT NULL DEFAULT 'read' CHECK (tier IN ('read', 'tier1', 'tier2')),
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_ops_tokens_hash ON ops_tokens(token_hash);

CREATE TABLE ops_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT,                  -- ops_tokens.id of the caller
  surface TEXT NOT NULL,          -- 'mcp' | 'rest'
  tool TEXT NOT NULL,             -- tool/endpoint name
  args TEXT,                      -- JSON of sanitized args
  status TEXT NOT NULL,           -- 'ok' | 'error' | 'denied'
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ops_audit_at ON ops_audit(at);
