/**
 * Local policy engine — evaluates tool calls against rules.
 *
 * Rules are evaluated top-to-bottom. First match wins.
 * If no rule matches, the default action applies.
 *
 * Supports both:
 *   - Semantic patterns: `pattern: sql-read` (human-friendly)
 *   - Regex matching: `args: { sql: "^SELECT" }` (power users)
 */

import type { PolicyRule, Action, PolicyResult, SemanticPattern } from './types.js';

/**
 * Action severity ranking — higher number is more restrictive.
 * Used to pick the most restrictive action across compound statements.
 */
const ACTION_SEVERITY: Record<Action, number> = {
  allow: 0,
  approve: 1,
  deny: 2,
};

/**
 * Any of these characters means a command is more than a bare "verb args …" and
 * must be decomposed before it can be trusted: control operators, command and
 * process substitution, grouping, redirections, expansions, and newlines.
 * Deliberately broad — a fully-safe command still resolves to allow after
 * decomposition, so over-triggering only costs a linear scan.
 */
const SHELL_METACHAR = /[\n;&|<>`(){}$]/;

/** Upper bounds so a hostile command can't turn the inline guard into a CPU sink. */
const MAX_SHELL_LENGTH = 100_000;
const MAX_SHELL_DEPTH = 50;

/**
 * Built-in semantic patterns.
 * Each maps to a tool name pattern and argument matchers.
 */
const SEMANTIC_PATTERNS: Record<SemanticPattern, { tool: string; args: Record<string, string> }> = {
  // NOTE: the sql-* `args` regexes are illustrative only — they show the leading
  // keywords each tier covers. Actual matching is done by classifySqlTier (a
  // quote/comment-aware scan of the whole statement), not by these prefixes, so a
  // read-led statement that performs a write/DDL is still classified correctly.
  'sql-read': {
    tool: 'query',
    args: { sql: '^\\s*(SELECT|EXPLAIN|SHOW|DESCRIBE|WITH)\\b' },
  },
  'sql-write': {
    tool: 'query',
    args: { sql: '^\\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT)\\b' },
  },
  'sql-destructive': {
    tool: 'query',
    args: { sql: '^\\s*(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\\b' },
  },
  'file-read': {
    tool: '{read_file,list_directory,search_files,get_file_info,list_allowed_directories}',
    args: {},
  },
  'file-write': {
    tool: '{write_file,edit_file,move_file,create_directory}',
    args: {},
  },
  'file-delete': {
    tool: '{delete_file,remove_directory}',
    args: {},
  },
  'shell-safe': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(ls|pwd|whoami|echo|cat|head|tail|wc|date|uname)\\b' },
  },
  'shell-risky': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(mv|cp|mkdir|chmod|chown|curl|wget|npm|pip)\\b' },
  },
  'shell-destructive': {
    tool: '{execute,run_command,shell,exec,run}',
    args: { command: '^\\s*(rm|rmdir|kill|killall|shutdown|reboot|mkfs|dd|sudo)\\b' },
  },
};

/**
 * Evaluate a tool call against a list of rules.
 *
 * For SQL args containing semicolons (compound statements like "SELECT 1; DROP TABLE x"),
 * each sub-statement is evaluated independently and the most restrictive action wins.
 *
 * For shell commands containing compound operators (;, &&, ||, |),
 * each sub-command is evaluated independently and the most restrictive action wins.
 */
export function evaluate(
  toolName: string,
  args: Record<string, unknown>,
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  // SQL: lex quote/comment-aware into statements. A ';' inside a string literal
  // is not a separator (so benign literals aren't mis-split), and an unterminated
  // string/comment can't be verified — fail closed. Each statement is classified
  // by its most dangerous operation (see matchesRule / classifySqlTier), not its
  // leading keyword, and the most restrictive result across statements wins.
  const sqlKey = args?.['sql'] !== undefined ? 'sql' : (args?.['query'] !== undefined ? 'query' : null);
  const sqlValue = sqlKey ? args[sqlKey] : undefined;
  if (typeof sqlValue === 'string' && sqlValue.trim().length > 0) {
    const scan = scanSql(sqlValue);
    if (scan.unbalanced) {
      return {
        action: 'deny',
        reason: 'SQL contains an unterminated string or comment',
        explanation: `Blocked: ${describeToolCall(toolName, args)}. The SQL has an unterminated string, ` +
          `identifier, or comment and cannot be verified as safe, so it is denied.`,
      };
    }
    // Drop comment-only / empty segments so an inert trailing comment can't raise
    // the worst tier of an otherwise-safe batch.
    const codeSegments = scan.segments.filter(s => s.code.length > 0);
    if (codeSegments.length > 1) {
      return evaluateCompound(toolName, args, sqlKey!, codeSegments.map(s => s.raw), rules, defaultAction);
    }
  }

  // Check for compound / obfuscated shell commands.
  // A blocked command can be hidden behind a control operator (; && || | &), a
  // newline, a command substitution ($(...) or backticks), a process substitution
  // (<(...) / >(...)), or a subshell group — none of which the safe-verb prefix
  // match catches on its own. Decompose the string (quote-aware) into the simple
  // commands it would actually run and evaluate each; most-restrictive wins.
  const cmdValue = args?.['command'] ?? args?.['cmd'];
  if (typeof cmdValue === 'string' && SHELL_METACHAR.test(cmdValue)) {
    const scan = decomposeShell(cmdValue);

    // Fail closed HARD: an execution construct we could not fully break down
    // (unbalanced substitution, here-doc, oversized/over-nested input) means a
    // command may run that we never got to classify — deny rather than guess.
    if (scan.unparseable) {
      return {
        action: 'deny',
        reason: 'Command contains a shell construct that could not be safely parsed',
        explanation: `Blocked: ${describeToolCall(toolName, args)}. The command contains a shell ` +
          `construct that could not be verified as safe (unbalanced or unsupported), so it is denied.`,
      };
    }

    const parts = scan.parts.length > 0 ? scan.parts : [cmdValue];
    const result = evaluateCompound(toolName, args, 'command', parts, rules, defaultAction);

    // A redirection (> >> <) is file I/O whose target we don't model. When every
    // command part is otherwise safe, never leave it at allow — surface it for a
    // human so an overwrite of a sensitive file isn't waved through silently.
    if (scan.sawRedirection && result.action === 'allow') {
      return {
        ...result,
        action: 'approve',
        explanation: result.explanation +
          ' (contains a shell redirection — downgraded to approval; output target not verified)',
      };
    }
    return result;
  }

  return evaluateSingle(toolName, args, rules, defaultAction);
}

/**
 * Evaluate a single (non-compound) tool call against rules.
 */
function evaluateSingle(
  toolName: string,
  args: Record<string, unknown>,
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  for (const rule of rules) {
    if (matchesRule(rule, toolName, args)) {
      return {
        action: rule.action,
        rule,
        reason: rule.reason,
        explanation: explainMatch(rule, toolName, args),
      };
    }
  }

  return {
    action: defaultAction,
    reason: `No rule matched — default action: ${defaultAction}`,
    explanation: explainDefault(toolName, args, defaultAction),
  };
}

/**
 * Evaluate compound statements by splitting on separator, evaluating each
 * sub-statement independently, and returning the most restrictive result.
 */
function evaluateCompound(
  toolName: string,
  args: Record<string, unknown>,
  argKey: string,
  statements: string[],
  rules: PolicyRule[],
  defaultAction: Action,
): PolicyResult {
  let worstResult: PolicyResult | null = null;
  let worstSeverity = -1;

  for (const stmt of statements) {
    const subArgs = { ...args, [argKey]: stmt };
    const result = evaluateSingle(toolName, subArgs, rules, defaultAction);
    const severity = ACTION_SEVERITY[result.action];
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worstResult = result;
    }
  }

  // Annotate explanation to mention compound evaluation
  if (worstResult && statements.length > 1) {
    worstResult.explanation = worstResult.explanation +
      ` (compound statement: ${statements.length} sub-statements evaluated, most restrictive applied)`;
  }

  return worstResult!;
}

/**
 * Result of decomposing a shell command string.
 *   parts          — the simple commands (verb + args) it would run, each of
 *                    which is classified independently by the caller.
 *   sawRedirection — an unquoted redirection (> >> <) was present; file I/O whose
 *                    target the policy does not model.
 *   unparseable    — an execution construct could not be fully extracted
 *                    (unbalanced substitution, here-doc, unterminated quote, or
 *                    input past the size/depth caps); the caller fails closed.
 */
interface ShellScan {
  parts: string[];
  sawRedirection: boolean;
  unparseable: boolean;
}

/**
 * Decompose a shell command into the simple commands it would actually run.
 *
 * Single-pass and quote-aware: operators inside quotes are literal, but command
 * substitution still fires inside double quotes (as the shell does). Command and
 * process substitutions ($(...), `...`, <(...), >(...)) are extracted and
 * recursively decomposed so a destructive command hidden inside one is surfaced
 * as its own part. Control operators (; && || | &) and newlines split the stream;
 * subshell parens are split points too. Anything that can't be fully reduced sets
 * `unparseable` so the caller can deny rather than trust a partial parse.
 */
function decomposeShell(cmd: string, depth = 0): ShellScan {
  const scan: ShellScan = { parts: [], sawRedirection: false, unparseable: false };
  if (depth > MAX_SHELL_DEPTH || cmd.length > MAX_SHELL_LENGTH) {
    scan.unparseable = true;
    return scan;
  }

  let segment = '';
  const flush = () => {
    const s = segment.trim();
    if (s) scan.parts.push(s);
    segment = '';
  };
  const absorb = (inner: string) => {
    const sub = decomposeShell(inner, depth + 1);
    scan.parts.push(...sub.parts);
    if (sub.sawRedirection) scan.sawRedirection = true;
    if (sub.unparseable) scan.unparseable = true;
  };
  // Extract a substitution body opened by '(' at `open`; recurse into it. Returns
  // the index just past the matching ')', or the string end (marking unparseable).
  const peelParen = (open: number): number => {
    const close = findMatchingParen(cmd, open);
    if (close === -1) { scan.unparseable = true; return cmd.length; }
    absorb(cmd.slice(open + 1, close));
    return close + 1;
  };

  let i = 0;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i]!;
    const c2 = cmd[i + 1];

    // Single-quoted span: fully literal.
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end === -1) { scan.unparseable = true; break; }
      segment += cmd.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Double-quoted span: literal except $(...) and `...`, which still execute.
    if (c === '"') {
      segment += '"';
      i++;
      let closed = false;
      while (i < n) {
        if (cmd[i] === '"') { closed = true; break; }
        if (cmd[i] === '$' && cmd[i + 1] === '(') {
          i = peelParen(i + 1);
          segment += ' ';
        } else if (cmd[i] === '`') {
          const close = cmd.indexOf('`', i + 1);
          if (close === -1) { scan.unparseable = true; i = n; break; }
          absorb(cmd.slice(i + 1, close));
          segment += ' ';
          i = close + 1;
        } else {
          segment += cmd[i];
          i++;
        }
      }
      if (!closed) { scan.unparseable = true; break; }
      segment += '"';
      i++;
      continue;
    }

    // Command substitution $(...)
    if (c === '$' && c2 === '(') { i = peelParen(i + 1); segment += ' '; continue; }
    // Backtick substitution `...`
    if (c === '`') {
      const close = cmd.indexOf('`', i + 1);
      if (close === -1) { scan.unparseable = true; break; }
      absorb(cmd.slice(i + 1, close));
      segment += ' ';
      i = close + 1;
      continue;
    }
    // Process substitution <(...) / >(...)
    if ((c === '<' || c === '>') && c2 === '(') { i = peelParen(i + 1); segment += ' '; continue; }
    // Here-doc / here-string: body is opaque and may run commands — fail closed.
    if (c === '<' && c2 === '<') { scan.unparseable = true; break; }
    // Redirections: >, >>, <, >&, <&, &>, &>>. File I/O — keep the verb, flag it.
    if (c === '&' && c2 === '>') {
      scan.sawRedirection = true;
      segment += ' ';
      i += cmd[i + 2] === '>' ? 3 : 2;
      continue;
    }
    if (c === '>' || c === '<') {
      scan.sawRedirection = true;
      segment += ' ';
      i += (c2 === '>' || c2 === '&') ? 2 : 1;
      continue;
    }
    // Control operators split the command stream.
    if (c === '\n' || c === ';') { flush(); i++; continue; }
    if (c === '&' && c2 === '&') { flush(); i += 2; continue; }
    if (c === '|' && c2 === '|') { flush(); i += 2; continue; }
    if (c === '&' || c === '|') { flush(); i++; continue; }
    // Subshell grouping: a group boundary starts a new simple command.
    if (c === '(' || c === ')') { flush(); i++; continue; }

    segment += c;
    i++;
  }
  flush();
  return scan;
}

/**
 * Given the index of an opening '(', return the index of its matching ')',
 * accounting for nesting and skipping quoted spans (where a paren is literal).
 * Returns -1 if no match is found.
 */
function findMatchingParen(cmd: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  const n = cmd.length;
  while (i < n) {
    const c = cmd[i];
    if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '"') { const e = cmd.indexOf('"', i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '`') { const e = cmd.indexOf('`', i + 1); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// SQL analysis
//
// A leading-keyword prefix match cannot gate SQL: a read-led statement can still
// perform a write or DDL (EXPLAIN ANALYZE <dml>, data-modifying CTEs, SELECT …
// INTO, dangerous functions like lo_export / COPY … PROGRAM), and a naive ';'
// split mis-fires on semicolons inside string literals. We instead lex the SQL
// (blanking string literals, quoted identifiers, and comments), split on real
// statement separators, and classify each statement by the most dangerous
// operation it contains — anywhere, not just at the front.
// ---------------------------------------------------------------------------

type SqlTier = 'read' | 'write' | 'destructive' | 'other';

const SQL_TIER_RANK: Record<SqlTier, number> = { other: -1, read: 0, write: 1, destructive: 2 };
const MAX_SQL_LENGTH = 200_000;
const MAX_SQL_DEPTH = 20;

// Classification is keyword-context aware to avoid two failure modes: a keyword
// hidden mid-statement that actually executes (bypass), and a keyword that is
// really a column/function name (false-positive deny/approve). Reserved DDL verbs
// are matched anywhere (they can't be bare identifiers, and this catches an
// unknown separator like MSSQL "GO"); non-reserved verbs and ambiguous write
// verbs are matched only in statement-leading position.

/** Reserved DDL verbs — matched anywhere (reserved words, never bare identifiers). */
const SQL_DDL_ANYWHERE = /\b(DROP|ALTER|CREATE|GRANT|REVOKE)\b|\bTRUNCATE\b(?!\s*\()/i;
/** Non-reserved admin/DDL verbs — leading only (they are valid column names). */
const SQL_DDL_LEADING = /^\s*(VACUUM|REINDEX|CLUSTER|ATTACH|DETACH|RENAME)\b/i;
/** Privilege/session escalation — deny even though SET is otherwise approve. */
const SQL_SET_ESCALATE = /^\s*SET\s+(ROLE|SESSION\s+AUTHORIZATION|GLOBAL)\b/i;
/** File / exec / remote / time-based function constructs — deny (all gated so a
 *  same-named column can't trip them). */
const SQL_DANGEROUS = new RegExp([
  /\bINTO\s+(OUTFILE|DUMPFILE)\b/,                 // MySQL file write / exfil
  /^\s*COPY\b[\s\S]*\bPROGRAM\b/m,                 // Postgres COPY … TO/FROM PROGRAM (command exec)
  /\bLOAD\s+DATA\b/,                               // MySQL LOAD DATA [LOCAL] INFILE
  /\bWAITFOR\s+DELAY\b/,                           // MSSQL time-based
  /\bxp_cmdshell\b/,                               // MSSQL command exec
  /\b(sp_oacreate|sp_execute_external_script)\b/,  // MSSQL OLE / script exec
  /\b(lo_export|lo_import|pg_read_file|pg_read_binary_file|pg_read_server_files|pg_stat_file|pg_ls_dir|pg_ls_logdir|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|load_extension|load_file|benchmark|pg_sleep|sleep|dblink\w*|openrowset|opendatasource|openquery)\s*\(/,
].map(r => r.source).join('|'), 'im');
/** Data-modifying verbs. INSERT/UPDATE/DELETE match anywhere (to catch data-
 *  modifying CTEs); INSERT excludes the MySQL INSERT() function form. */
const SQL_WRITE_ANYWHERE = /\b(UPDATE|DELETE)\b|\bINSERT\b(?!\s*\()/i;
/** Write verbs that are only writes in leading position (else they are functions
 *  or column names: REPLACE()/CALL as a column, etc.). */
const SQL_WRITE_LEADING = /^\s*(MERGE|REPLACE|UPSERT|CALL|EXEC|EXECUTE)\b/i;
/** Session/config statements — approve (SET ROLE/GLOBAL is escalated above). */
const SQL_SESSION = /^\s*(SET|USE|RESET)\b/i;
/** Transaction control — inert on its own, classified read so it can't poison a batch. */
const SQL_TXN_CONTROL = /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
/** Pure-read leading keywords (only reached when no write/destructive token present). */
const SQL_READ_LEAD = /^\s*(SELECT|EXPLAIN|SHOW|DESCRIBE|DESC|WITH|VALUES|TABLE)\b/i;
/** SELECT … INTO <table> (Postgres CREATE-TABLE-AS / MSSQL SELECT INTO) — deny.
 *  Excludes INTO OUTFILE/DUMPFILE (handled above) and INTO @var / :var (variables). */
const SQL_SELECT_INTO = /\bINTO\s+(?!OUTFILE\b|DUMPFILE\b)(TEMP\s+|TEMPORARY\s+|UNLOGGED\s+)?(TABLE\s+)?["`A-Za-z_#]/i;

interface SqlScan { segments: { raw: string; code: string }[]; unbalanced: boolean; }

/**
 * Lex a SQL string into statements. Each returned segment carries the original
 * `raw` text and a `code` skeleton with string literals, quoted identifiers, and
 * comments blanked to spaces. Splits on ';' only at statement level. Sets
 * `unbalanced` when a string/comment/dollar-quote never terminates (fail closed).
 * MySQL executable comments (/*!  … *​/) are treated as CODE, not blanked.
 */
function scanSql(sql: string, depth = 0): SqlScan {
  const scan: SqlScan = { segments: [], unbalanced: false };
  if (depth > MAX_SQL_DEPTH || sql.length > MAX_SQL_LENGTH) { scan.unbalanced = true; return scan; }

  let code = '';
  let rawStart = 0;
  const push = (rawEnd: number) => {
    const raw = sql.slice(rawStart, rawEnd).trim();
    const c = code.trim();
    if (raw || c) scan.segments.push({ raw, code: c });
    code = '';
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const c2 = sql[i + 1];

    // Line comments: '--' (only when followed by whitespace/EOL — MySQL requires
    // this, and scanning '--x' as code is the fail-safe choice for other dialects)
    // or '#' (MySQL).
    if ((c === '-' && c2 === '-' && (i + 2 >= n || /\s/.test(sql[i + 2]!))) || c === '#') {
      const nl = sql.indexOf('\n', i);
      code += ' ';
      i = nl === -1 ? n : nl;
      continue;
    }
    // Block comments /* … */ (nested) and MySQL executable comments /*! … */
    if (c === '/' && c2 === '*') {
      const end = findBlockCommentEnd(sql, i); // index just past the closing */
      if (end === -1) { scan.unbalanced = true; break; }
      if (sql[i + 2] === '!') {
        // Executable comment: MySQL runs the body, so scan it as code.
        let j = i + 3;
        while (j < n && sql[j]! >= '0' && sql[j]! <= '9') j++; // optional version gate
        const inner = sql.slice(j, end - 2);
        const innerScan = scanSql(inner, depth + 1);
        if (innerScan.unbalanced) { scan.unbalanced = true; break; }
        code += ' ' + innerScan.segments.map(s => s.code).join(' ') + ' ';
      } else {
        code += ' ';
      }
      i = end;
      continue;
    }
    // Single-quoted string literal ('' escape)
    if (c === "'") {
      const end = skipQuoted(sql, i, "'");
      if (end === -1) { scan.unbalanced = true; break; }
      code += ' ';
      i = end;
      continue;
    }
    // Double-quoted identifier ("" escape)
    if (c === '"') {
      const end = skipQuoted(sql, i, '"');
      if (end === -1) { scan.unbalanced = true; break; }
      code += ' ';
      i = end;
      continue;
    }
    // Backtick identifier (MySQL)
    if (c === '`') {
      const end = sql.indexOf('`', i + 1);
      if (end === -1) { scan.unbalanced = true; break; }
      code += ' ';
      i = end + 1;
      continue;
    }
    // Dollar-quoted string (Postgres): $tag$ … $tag$. Only opens at a token
    // boundary — '$' glued to an identifier char is part of that identifier
    // (Postgres allows '$' in identifiers), not a dollar-quote opener.
    if (c === '$' && !/[A-Za-z0-9_$]/.test(i > 0 ? sql[i - 1]! : '')) {
      const dq = matchDollarQuote(sql, i);
      if (dq !== null) {
        if (dq === -1) { scan.unbalanced = true; break; }
        code += ' ';
        i = dq;
        continue;
      }
      // otherwise a plain '$' (e.g. $1 placeholder) — fall through as code
    }
    // Statement separator
    if (c === ';') { push(i); i++; rawStart = i; continue; }

    code += c;
    i++;
  }

  if (scan.unbalanced) return scan;
  push(n);
  return scan;
}

/** Skip a quoted span starting at `open` (a quote char), honoring doubled-quote escapes. */
function skipQuoted(s: string, open: number, q: string): number {
  let i = open + 1;
  const n = s.length;
  while (i < n) {
    if (s[i] === q) {
      if (s[i + 1] === q) { i += 2; continue; } // doubled → escaped quote
      return i + 1;                              // closing quote
    }
    i++;
  }
  return -1;
}

/**
 * From a slash-star opener, return the index just past the FIRST closing
 * star-slash. Block comments are treated as non-nesting: MySQL/ANSI close at the
 * first terminator, and for a dialect-blind guard closing early is fail-safe — it
 * exposes more text as code (worst case an over-deny) rather than blanking code
 * the engine would run.
 */
function findBlockCommentEnd(s: string, open: number): number {
  const close = s.indexOf('*/', open + 2);
  return close === -1 ? -1 : close + 2;
}

/**
 * If `open` (a '$') begins a Postgres dollar-quoted string ($tag$ … $tag$),
 * return the index just past the closing tag, or -1 if it never closes. Returns
 * null when it is not a dollar-quote opener at all (e.g. a $1 placeholder).
 */
function matchDollarQuote(s: string, open: number): number | null {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(open));
  if (!m) return null;
  const tag = m[0];
  const close = s.indexOf(tag, open + tag.length);
  if (close === -1) return -1;
  return close + tag.length;
}

/** Classify a single statement's code skeleton by its most dangerous operation. */
function classifySqlTier(code: string): SqlTier {
  if (!code) return 'other';
  // Strip leading '(' so a parenthesised leading SELECT still reads as a read.
  const lead = code.replace(/^[\s(]+/, '');
  if (SQL_DANGEROUS.test(code) || SQL_DDL_ANYWHERE.test(code) ||
      SQL_DDL_LEADING.test(lead) || SQL_SET_ESCALATE.test(lead)) return 'destructive';
  // A write verb (INSERT/UPDATE/…) owns its own INTO, so check writes before the
  // bare SELECT … INTO (CREATE-TABLE-AS) rule to avoid misreading a data-modifying
  // CTE like `WITH x AS (INSERT INTO t …) SELECT …` as a table creation.
  if (SQL_WRITE_ANYWHERE.test(code) || SQL_WRITE_LEADING.test(lead)) return 'write';
  if (/^\s*(SELECT|WITH)\b/i.test(lead) && SQL_SELECT_INTO.test(code)) return 'destructive';
  if (SQL_SESSION.test(lead)) return 'write';         // approve
  if (SQL_TXN_CONTROL.test(lead)) return 'read';      // inert on its own
  if (SQL_READ_LEAD.test(lead)) return 'read';
  return 'other';
}

/** Worst (most restrictive) tier over a value's statements; unbalanced ⇒ destructive. */
function sqlTierOf(sqlValue: string): SqlTier {
  const scan = scanSql(sqlValue);
  if (scan.unbalanced) return 'destructive';
  let worst: SqlTier = 'other';
  for (const seg of scan.segments) {
    const t = classifySqlTier(seg.code);
    if (SQL_TIER_RANK[t] > SQL_TIER_RANK[worst]) worst = t;
  }
  return worst;
}

/**
 * Check if a tool call matches a single rule.
 */
function matchesRule(
  rule: PolicyRule,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  // If rule uses a semantic pattern, expand it
  const pattern = rule.match.pattern ? SEMANTIC_PATTERNS[rule.match.pattern] : null;

  // Tool name matching: use expanded pattern tool if no explicit tool, or the rule's tool
  const toolPattern = pattern && rule.match.tool === '*' ? pattern.tool : rule.match.tool;
  if (!matchToolName(toolPattern, toolName)) {
    return false;
  }

  // Built-in SQL semantic patterns classify by the most dangerous operation the
  // statement performs (robust to read-led writes, dangerous functions, and
  // semicolons inside string literals) rather than a leading-keyword regex. A
  // rule with an explicit `args` override still takes the regex path below.
  if (rule.match.pattern && rule.match.pattern.startsWith('sql-') && !rule.match.args) {
    const sqlVal = args?.['sql'] ?? args?.['query'];
    if (typeof sqlVal !== 'string') return false;
    const tier = sqlTierOf(sqlVal);
    if (rule.match.pattern === 'sql-read') return tier === 'read';
    if (rule.match.pattern === 'sql-write') return tier === 'write';
    if (rule.match.pattern === 'sql-destructive') return tier === 'destructive';
    return false;
  }

  // Args matching: explicit args override pattern args
  const argPatterns = rule.match.args ?? (pattern?.args && Object.keys(pattern.args).length > 0 ? pattern.args : undefined);
  if (argPatterns) {
    if (!matchArgs(argPatterns, args)) {
      return false;
    }
  }

  return true;
}

/**
 * Match a tool name against a pattern.
 * Supports: exact, glob ("db_*"), multi ("{read_file,write_file}").
 */
function matchToolName(pattern: string, value: string): boolean {
  if (pattern === '*') return true;

  // Multi-match: {a,b,c}
  if (pattern.startsWith('{') && pattern.endsWith('}')) {
    const options = pattern.slice(1, -1).split(',').map(s => s.trim());
    return options.some(opt => matchGlob(opt, value));
  }

  return matchGlob(pattern, value);
}

/**
 * Match a string against a glob pattern.
 * Supports: exact match, "*" (match all), "db_*", "*_query".
 */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return regex.test(value);
}

/**
 * Match argument values against regex patterns.
 * All patterns must match for the rule to apply.
 */
function matchArgs(
  patterns: Record<string, string>,
  args: Record<string, unknown>,
): boolean {
  if (!args || typeof args !== 'object') return false;
  for (const [key, pattern] of Object.entries(patterns)) {
    const value = args[key];
    if (value === undefined || value === null) return false;

    try {
      const regex = new RegExp(pattern, 'i');
      if (!regex.test(String(value))) return false;
    } catch {
      // Invalid regex — treat as literal match
      if (String(value) !== pattern) return false;
    }
  }

  return true;
}

/**
 * Generate a plain-English explanation for a matched rule.
 */
function explainMatch(rule: PolicyRule, toolName: string, args: Record<string, unknown>): string {
  const actionVerb = rule.action === 'allow'
    ? 'Allowed'
    : rule.action === 'deny'
      ? 'Blocked'
      : 'Held for approval';

  const what = describeToolCall(toolName, args);
  const why = rule.description ?? rule.reason ?? `matched rule "${rule.name}"`;

  return `${actionVerb}: ${what}. ${why}.`;
}

/**
 * Generate a plain-English explanation for a default action.
 */
function explainDefault(toolName: string, args: Record<string, unknown>, action: Action): string {
  const actionVerb = action === 'allow'
    ? 'Allowed'
    : action === 'deny'
      ? 'Blocked'
      : 'Held for approval';
  const what = describeToolCall(toolName, args);
  return `${actionVerb}: ${what}. No matching rule — default policy applied.`;
}

/**
 * Describe a tool call in plain language.
 */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return `tool call: ${toolName}`;

  const sql = args['sql'] ?? args['query'];
  if (sql) {
    const s = String(sql).trim();
    const verb = s.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (verb === 'SELECT') return `read query on ${extractTarget(s)}`;
    if (verb === 'INSERT') return `insert into ${extractTarget(s)}`;
    if (verb === 'UPDATE') return `update on ${extractTarget(s)}`;
    if (verb === 'DELETE') return `delete from ${extractTarget(s)}`;
    if (verb === 'DROP') return `drop ${extractTarget(s)}`;
    if (verb === 'TRUNCATE') return `truncate ${extractTarget(s)}`;
    if (verb === 'ALTER') return `alter ${extractTarget(s)}`;
    if (verb === 'CREATE') return `create ${extractTarget(s)}`;
    return `SQL: ${s.length > 50 ? s.substring(0, 47) + '...' : s}`;
  }

  const cmd = args['command'] ?? args['cmd'];
  if (cmd) {
    const s = String(cmd).trim();
    const firstToken = s.split(/\s+/)[0] ?? '';
    return `${firstToken} command: ${s.length > 50 ? s.substring(0, 47) + '...' : s}`;
  }

  const path = args['path'] ?? args['file'] ?? args['uri'];
  if (path) return `${toolName} on ${String(path)}`;

  return `tool call: ${toolName}`;
}

/**
 * Extract target table/object from SQL.
 */
function extractTarget(sql: string): string {
  // Try to find FROM/INTO/TABLE/ON target
  const m = sql.match(/(?:FROM|INTO|TABLE|ON|UPDATE)\s+([^\s(,;]+)/i);
  if (m) return m[1]!;
  // Fallback: just take first few words
  const words = sql.split(/\s+/).slice(0, 4).join(' ');
  return words.length > 40 ? words.substring(0, 37) + '...' : words;
}

/**
 * Export semantic patterns for external use (e.g., config validation).
 */
export const semanticPatterns = SEMANTIC_PATTERNS;
