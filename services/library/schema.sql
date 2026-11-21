-- The public library of Autark (worker.js). One row per entry, its words in entries_fts, one rating per installation.
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'skill' | 'note'
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '{}',   -- JSON {relative path: text} beside SKILL.md
  license TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',    -- where it came from (a seeded entry's repository)
  author TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,                -- sha256 of the installation id that shared it ('openautark' for seeded ones)
  rev TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,   -- the sum of all ratings
  votes INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,    -- how often it was opened
  hidden INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_owner ON entries (owner, name);
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(id UNINDEXED, name, description, body);
CREATE TABLE IF NOT EXISTS ratings (
  entry TEXT NOT NULL,
  voter TEXT NOT NULL,                -- sha256 of the installation id
  stars INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  place TEXT NOT NULL DEFAULT '',     -- keyed hash of the caller's address and month: one rating per place counts
  PRIMARY KEY (entry, voter)
);
CREATE TABLE IF NOT EXISTS recent (key TEXT NOT NULL, at INTEGER NOT NULL); -- shares and ratings per keyed address hash and day, for the hourly limits
CREATE INDEX IF NOT EXISTS recent_key ON recent (key, at);
