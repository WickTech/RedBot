/**
 * Idempotency / deduplication, backed by Redis.
 *
 * Why this exists: Reddit can deliver the same trigger event more than once, and
 * a catch-up scan may re-examine comments the trigger already handled. Without a
 * durable "seen" record the bot would post duplicate replies — the single most
 * common way keyword bots get reported and banned.
 *
 * The mechanism is a per-thing marker key (`kwbot:seen:<id>`) set the first time
 * we act on a comment. {@link markIfNew} is the atomic test-and-set used by
 * handlers: it returns `true` only for the *first* caller for a given id.
 *
 * Like {@link stats}, this depends on a small {@link RedisLike} surface rather
 * than Devvit's concrete client, so it is unit-testable with an in-memory fake.
 */

/**
 * The subset of the Redis API this module needs. Devvit's `RedisClient`
 * satisfies it structurally (its `set` returns `Promise<string>`).
 *
 * On `SET ... NX`, Redis writes the value and returns it when the key was new,
 * and returns an empty/nil result when the key already existed. We model that as
 * `Promise<string>` and treat a falsy result as "already existed".
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date },
  ): Promise<string>;
  exists(...keys: string[]): Promise<number>;
}

/** Key prefix for per-thing "already handled" markers. */
const SEEN_PREFIX = 'kwbot:seen:';

/** Default marker lifetime: 30 days. Long enough to outlive any retry/backfill. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Test-and-set whether `thingId` has been handled before.
 *
 * Atomic via Redis `SET key value NX`: the first caller for a given id gets the
 * key written and receives `true`; every subsequent caller sees the existing key
 * and receives `false`. This is the idempotency guarantee handlers rely on.
 *
 * @returns `true` if this is the first time we've seen `thingId` (caller should
 *   proceed to reply); `false` if it was already handled (caller should skip).
 */
export async function markIfNew(
  redis: RedisLike,
  thingId: string,
  now: Date = new Date(),
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<boolean> {
  const key = SEEN_PREFIX + thingId;
  const expiration = new Date(now.getTime() + ttlMs);
  const result = await redis.set(key, '1', { nx: true, expiration });
  // With NX, a truthy result means the write happened (we just claimed the id);
  // an empty/nil result means the key already existed (someone got here first).
  return Boolean(result);
}

/** Non-mutating check: has `thingId` already been handled? */
export async function isSeen(redis: RedisLike, thingId: string): Promise<boolean> {
  const count = await redis.exists(SEEN_PREFIX + thingId);
  return count > 0;
}

/** Key prefix for per-user, per-keyword cooldown markers. */
const COOLDOWN_PREFIX = 'kwbot:cooldown:';

/**
 * Claim a cooldown slot for (`user`, `keyword`), succeeding only if one isn't
 * already active. Implemented as a `SET NX` with a TTL equal to the cooldown
 * window: the first caller within the window claims it; later callers see the
 * existing key and are rejected until it expires.
 *
 * Distinct from {@link markIfNew} (which dedups a *single comment forever*); this
 * rate-limits how often the *same user* can re-trigger the *same keyword*.
 *
 * @returns `true` if the slot was claimed (caller may reply); `false` if the
 *   user is still within the cooldown window for that keyword.
 */
export async function claimCooldown(
  redis: RedisLike,
  user: string,
  keyword: string,
  cooldownSeconds: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (cooldownSeconds <= 0) return true; // cooldown disabled
  const key = `${COOLDOWN_PREFIX}${user}:${keyword}`;
  const expiration = new Date(now.getTime() + cooldownSeconds * 1000);
  const result = await redis.set(key, '1', { nx: true, expiration });
  return Boolean(result);
}
