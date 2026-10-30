-- Anonymous comments for the landing page.
--
-- Design notes, because a comment table is the part of a site that gets abused:
--
--   · There is no email, no name and no IP column. A comment is tied to a random
--     browser-held token only through `author_hash`, a one-way SHA-256 digest.
--     The token itself is never sent to this database, so a dump of this table
--     cannot be used to impersonate anyone or delete their comments.
--   · `deleted` is a soft flag but `body` is wiped in the same statement, so a
--     deletion really removes the text while leaving a row that keeps the rate
--     limiter honest (a deleted comment still counts as one posted).
--   · `status` is 'visible' or 'hidden'. Hidden rows are what the filters and the
--     moderator produce; they are never returned by the public feed.
--   · `body_hash` is only used to catch the same text posted repeatedly, which
--     is the cheapest spam signature there is.

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT    PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  body        TEXT    NOT NULL,
  body_hash   TEXT    NOT NULL,
  nickname    TEXT    NOT NULL,
  author_hash TEXT    NOT NULL,
  avatar      INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  auto_hidden INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER
);

-- The public feed: newest visible, undeleted first.
CREATE INDEX IF NOT EXISTS comments_feed
  ON comments (deleted, status, created_at DESC);

-- Rate limits and "your own comments" both look up by author.
CREATE INDEX IF NOT EXISTS comments_author
  ON comments (author_hash, created_at DESC);

-- Duplicate detection within a short window.
CREATE INDEX IF NOT EXISTS comments_body_hash
  ON comments (body_hash, created_at DESC);
