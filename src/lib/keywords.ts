/**
 * Pure keyword-matching logic.
 *
 * This module is intentionally free of any Devvit / Reddit / Redis imports so it
 * can be unit-tested in isolation and reasoned about as a pure function. The
 * handler layer (src/handlers) is responsible for I/O; this layer only decides
 * *whether* a piece of text matches and *which* canned reply to send.
 */

/** A single keyword rule: a trigger word/phrase and the reply it produces. */
export interface KeywordRule {
  /** The keyword or phrase to look for (case-insensitive, whole-word). */
  readonly keyword: string;
  /** The reply body to post when this rule matches. Markdown is allowed. */
  readonly reply: string;
}

/** The result of matching a body of text against a set of rules. */
export interface MatchResult {
  /** The rule that matched, or `null` if nothing matched. */
  readonly rule: KeywordRule | null;
  /** The normalized keyword that matched (lowercased), for stats keying. */
  readonly matchedKeyword: string | null;
}

const NO_MATCH: MatchResult = { rule: null, matchedKeyword: null };

/**
 * Escape a string so it can be embedded literally inside a RegExp.
 * Prevents a keyword like "c++" or "(test)" from being interpreted as a pattern.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive, whole-word matcher for a keyword.
 *
 * Uses lookarounds rather than `\b` so that keywords containing non-word
 * characters (e.g. "c++", "node.js") still match at sensible boundaries.
 * A "boundary" here is start/end of string or a whitespace character.
 */
function buildKeywordPattern(keyword: string): RegExp {
  const escaped = escapeRegExp(keyword.trim());
  // Input is fully escaped above, so no user-controlled regex syntax reaches here.
  // nosemgrep: detect-non-literal-regexp
  return new RegExp(`(?:^|\\s)${escaped}(?=$|\\s|[.,!?;:])`, 'i');
}

/**
 * Parse a raw, user-entered keyword configuration string into structured rules.
 *
 * Expected format (one rule per line):
 *   keyword => reply text
 *
 * Lines that are blank or start with `#` are ignored. Lines without a `=>`
 * separator are skipped (callers may surface these as warnings). Duplicate
 * keywords keep the first occurrence so behavior is deterministic.
 */
export function parseRules(raw: string): KeywordRule[] {
  const rules: KeywordRule[] = [];
  const seen = new Set<string>();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=>');
    if (separatorIndex === -1) continue;

    const keyword = trimmed.slice(0, separatorIndex).trim();
    const reply = trimmed.slice(separatorIndex + 2).trim();
    if (keyword === '' || reply === '') continue;

    const normalized = keyword.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    rules.push({ keyword, reply });
  }

  return rules;
}

/**
 * Find the first rule whose keyword appears in `text` as a whole word.
 *
 * Rules are evaluated in order, so earlier rules take precedence. Returns a
 * {@link MatchResult} describing the match (or the absence of one).
 */
export function matchFirst(text: string, rules: readonly KeywordRule[]): MatchResult {
  if (!text) return NO_MATCH;

  for (const rule of rules) {
    if (buildKeywordPattern(rule.keyword).test(text)) {
      return { rule, matchedKeyword: rule.keyword.toLowerCase() };
    }
  }

  return NO_MATCH;
}

/**
 * Render a reply, substituting simple `{{placeholders}}`.
 *
 * Supported tokens:
 *   {{author}}  - the comment author's username (without the leading u/)
 *   {{keyword}} - the keyword that matched
 *   {{reply}}   - the matched rule's reply text (so a template can wrap it)
 *
 * Unknown tokens are left untouched so a typo never silently drops content.
 */
export function renderReply(
  template: string,
  vars: { author?: string; keyword?: string; reply?: string },
): string {
  return template
    .replace(/\{\{\s*author\s*\}\}/g, vars.author ?? '')
    .replace(/\{\{\s*keyword\s*\}\}/g, vars.keyword ?? '')
    .replace(/\{\{\s*reply\s*\}\}/g, vars.reply ?? '');
}
