/**
 * Persistent stats counters, backed by Redis hashes.
 *
 * The class depends only on the small {@link RedisLike} interface rather than on
 * Devvit's concrete `RedisClient`. This keeps the module:
 *   - testable (tests inject an in-memory fake),
 *   - decoupled (no import of @devvit/public-api here),
 * while still being a drop-in for `context.redis`, whose method set is a superset
 * of RedisLike.
 */

/** The subset of the Redis API this module needs. Devvit's client satisfies it. */
export interface RedisLike {
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
}

/** A snapshot of the bot's lifetime activity. */
export interface StatsSnapshot {
  /** Total comments the bot examined. */
  readonly scanned: number;
  /** Total replies the bot actually posted. */
  readonly replied: number;
  /** Per-keyword reply tallies, keyed by the normalized keyword. */
  readonly perKeyword: Readonly<Record<string, number>>;
}

/** Redis hash key under which all counters live. */
const STATS_KEY = 'kwbot:stats';
/** Field names for the top-level counters. */
const FIELD_SCANNED = 'scanned';
const FIELD_REPLIED = 'replied';
/** Prefix distinguishing per-keyword fields from top-level ones. */
const KEYWORD_PREFIX = 'kw:';

/** Coerce a Redis string field to a non-negative integer, defaulting to 0. */
function toCount(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Reads/writes the bot's counters in a single Redis hash.
 *
 * Using one hash (rather than many top-level keys) keeps reads cheap: a single
 * `hGetAll` returns everything needed for the stats view.
 */
export class Stats {
  constructor(private readonly redis: RedisLike) {}

  /** Increment the "comments scanned" counter. */
  async incScanned(): Promise<void> {
    await this.redis.hIncrBy(STATS_KEY, FIELD_SCANNED, 1);
  }

  /**
   * Record that a reply was posted for `keyword`, bumping both the global
   * "replied" counter and the per-keyword tally.
   */
  async incReplied(keyword: string): Promise<void> {
    await this.redis.hIncrBy(STATS_KEY, FIELD_REPLIED, 1);
    await this.redis.hIncrBy(STATS_KEY, KEYWORD_PREFIX + keyword, 1);
  }

  /** Read a full snapshot for rendering the stats view. */
  async snapshot(): Promise<StatsSnapshot> {
    const raw = await this.redis.hGetAll(STATS_KEY);
    return parseSnapshot(raw ?? {});
  }
}

/**
 * Pure transform from a raw Redis hash into a {@link StatsSnapshot}.
 *
 * Exported separately so it can be unit-tested without any Redis at all.
 */
export function parseSnapshot(raw: Record<string, string>): StatsSnapshot {
  const perKeyword: Record<string, number> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field.startsWith(KEYWORD_PREFIX)) {
      perKeyword[field.slice(KEYWORD_PREFIX.length)] = toCount(value);
    }
  }
  return {
    scanned: toCount(raw[FIELD_SCANNED]),
    replied: toCount(raw[FIELD_REPLIED]),
    perKeyword,
  };
}

/** Render a snapshot as a compact Markdown block for a Reddit post/comment. */
export function renderStats(snapshot: StatsSnapshot): string {
  const lines: string[] = [
    '## 🤖 Keyword Bot — Stats',
    '',
    `- **Comments scanned:** ${snapshot.scanned}`,
    `- **Replies posted:** ${snapshot.replied}`,
  ];

  const entries = Object.entries(snapshot.perKeyword).sort((a, b) => b[1] - a[1]);
  if (entries.length > 0) {
    lines.push('', '**Replies by keyword:**', '');
    for (const [keyword, count] of entries) {
      lines.push(`- \`${keyword}\`: ${count}`);
    }
  }

  return lines.join('\n');
}
