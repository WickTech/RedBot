import { describe, it, expect, beforeEach } from 'vitest';
import { markIfNew, isSeen, claimCooldown, type RedisLike } from '../src/lib/dedup.js';

/**
 * In-memory fake of the small Redis surface dedup needs, including SET NX
 * semantics and expiration tracking, so we can assert idempotency precisely.
 */
class FakeRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; xx?: boolean; expiration?: Date },
  ): Promise<string> {
    // SET NX returns an empty string when the key already exists (no write).
    if (options?.nx && this.store.has(key)) return '';
    this.store.set(key, {
      value,
      expiresAt: options?.expiration?.getTime(),
    });
    return value;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.reduce((count, key) => count + (this.store.has(key) ? 1 : 0), 0);
  }

  /** Test helper: read the stored expiry for a "seen" marker. */
  expiryOf(thingId: string): number | undefined {
    return this.store.get(`kwbot:seen:${thingId}`)?.expiresAt;
  }
}

describe('markIfNew', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('returns true the first time an id is seen', async () => {
    expect(await markIfNew(redis, 't1_abc')).toBe(true);
  });

  it('returns false on every subsequent call for the same id', async () => {
    expect(await markIfNew(redis, 't1_abc')).toBe(true);
    expect(await markIfNew(redis, 't1_abc')).toBe(false);
    expect(await markIfNew(redis, 't1_abc')).toBe(false);
  });

  it('tracks distinct ids independently', async () => {
    expect(await markIfNew(redis, 't1_a')).toBe(true);
    expect(await markIfNew(redis, 't1_b')).toBe(true);
    expect(await markIfNew(redis, 't1_a')).toBe(false);
  });

  it('sets an expiration TTL relative to "now"', async () => {
    const now = new Date('2026-06-03T00:00:00Z');
    const oneDay = 24 * 60 * 60 * 1000;
    await markIfNew(redis, 't1_ttl', now, oneDay);
    expect(redis.expiryOf('t1_ttl')).toBe(now.getTime() + oneDay);
  });
});

describe('isSeen', () => {
  it('reflects whether an id has been marked', async () => {
    const redis = new FakeRedis();
    expect(await isSeen(redis, 't1_x')).toBe(false);
    await markIfNew(redis, 't1_x');
    expect(await isSeen(redis, 't1_x')).toBe(true);
  });
});

describe('claimCooldown', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('grants the slot on first claim and blocks the second', async () => {
    expect(await claimCooldown(redis, 'alice', 'help', 600)).toBe(true);
    expect(await claimCooldown(redis, 'alice', 'help', 600)).toBe(false);
  });

  it('treats different users and keywords as independent slots', async () => {
    expect(await claimCooldown(redis, 'alice', 'help', 600)).toBe(true);
    expect(await claimCooldown(redis, 'bob', 'help', 600)).toBe(true);
    expect(await claimCooldown(redis, 'alice', 'bug', 600)).toBe(true);
    expect(await claimCooldown(redis, 'alice', 'help', 600)).toBe(false);
  });

  it('always grants when cooldown is disabled (<= 0)', async () => {
    expect(await claimCooldown(redis, 'alice', 'help', 0)).toBe(true);
    expect(await claimCooldown(redis, 'alice', 'help', 0)).toBe(true);
  });
});
