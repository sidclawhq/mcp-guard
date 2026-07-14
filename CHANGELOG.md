# Changelog

All notable changes to `sidclaw-mcp-guard` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/) format.

## [0.1.3] — Unreleased

### Security

Fixes two policy-engine bypasses in `src/policy.ts` where a call that should be
**denied** or **held for approval** could be classified **allow** and forwarded to
the wrapped server. Both the deny gate and the approval gate were affected.
See the accompanying security advisory (GHSA / CVE: _pending_).

- **Shell metacharacter bypass.** Compound-command detection triggered only on
  `; | &`, and the "safe verb" match was an unanchored prefix, so a blocked
  command hidden behind command substitution `$(…)` / backticks, a newline, a
  bare `&`, process substitution `<(…)` / `>(…)`, or a subshell group was
  classified `allow`. Commands are now decomposed with a quote/paren-aware,
  single-pass parser that evaluates every command the input would run and **fails
  closed** (deny) on anything it cannot fully parse.
- **SQL classification bypass.** SQL was classified by its leading keyword and
  split on a raw `;`, so read-led statements that actually write or execute
  (`EXPLAIN ANALYZE <dml>`, data-modifying CTEs, `SELECT … INTO`,
  `INTO OUTFILE`/`DUMPFILE`, `COPY … PROGRAM`, `lo_export`/`pg_read_file`/
  `xp_cmdshell`/`load_extension`/…) were classified `allow`, and semicolons inside
  string literals caused false denials. SQL is now lexed quote/comment-aware
  (handling string literals, dollar-quoting, quoted identifiers, comments, and
  MySQL executable comments) and classified by the most dangerous operation
  anywhere in each statement, not just the leading keyword.

### Fixed

- Benign commands and queries that merely contain a metacharacter or keyword
  inside a quote (e.g. `echo "a; b"`, `SELECT ';' AS sep`) are no longer
  hard-denied.
- Removed dead code in compound-statement annotation.

### Notes

- Added a regression suite covering the above (162 tests total).
- Because classification is dialect-blind and errs toward safety, some benign
  compound commands are now surfaced for **approval** rather than silently
  allowed (e.g. a command containing a redirection), and rare ambiguous SQL (e.g.
  MySQL backslash-escaped string literals) may fail closed to deny. This is the
  intended bias for a security control.

Credit: shell bypass reported responsibly by **Ansh** (GitHub: `@GOJO-SENPA1`).
