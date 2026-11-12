import { describe, it, expect, vi } from 'vitest';
import { handleCommentSubmit } from '../src/handlers/onComment.js';

/** In-memory Redis fake covering set(NX)/exists/del/hIncrBy/hGetAll. */
function makeRedis() {
  const kv = new Map<string, string>();
  const hashes = new Map<string, Record<string, number>>();
  return {
    kv,
    async set(key: string, value: string, o?: { nx?: boolean }) {
      if (o?.nx && kv.has(key)) return '';
      kv.set(key, value);
      return value;
    },
    async exists(...keys: string[]) {
      return keys.filter((k) => kv.has(k)).length;
    },
    async del(...keys: string[]) {
      keys.forEach((k) => kv.delete(k));
    },
    async hIncrBy(key: string, f: string, n: number) {
      const h = (hashes.get(key) ?? {}) as Record<string, number>;
      h[f] = (h[f] ?? 0) + n;
      hashes.set(key, h);
      return h[f];
    },
    async hGetAll(key: string) {
      return Object.fromEntries(
        Object.entries(hashes.get(key) ?? {}).map(([k, v]) => [k, String(v)]),
      );
    },
  };
}

function makeContext(submitComment: ReturnType<typeof vi.fn>) {
  const settings: Record<string, unknown> = {
    enabled: true,
    'keyword-rules': 'help => Here to help',
    'reply-template': '',
    'reply-cooldown-seconds': 600,
  };
  return {
    appName: 'kwbot',
    redis: makeRedis(),
    settings: { get: async (k: string) => settings[k] },
    reddit: { submitComment },
  };
}

const event = {
  comment: { id: 't1_abc', body: 'I need help please' },
  author: { name: 'alice' },
};

describe('handleCommentSubmit mark-after-submit', () => {
  it('keeps the comment marked after a successful reply', async () => {
    const submit = vi.fn().mockResolvedValue({});
    const ctx = makeContext(submit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCommentSubmit(event as any, ctx as any);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(ctx.redis.kv.has('kwbot:seen:t1_abc')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCommentSubmit(event as any, ctx as any);
    expect(submit).toHaveBeenCalledTimes(1); // deduped
  });

  it('releases the marker and cooldown when submit fails, so a retry replies', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    const ctx = makeContext(submit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handleCommentSubmit(event as any, ctx as any)).rejects.toThrow('boom');
    expect(ctx.redis.kv.has('kwbot:seen:t1_abc')).toBe(false);
    expect([...ctx.redis.kv.keys()].some((k) => k.startsWith('kwbot:cooldown:'))).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCommentSubmit(event as any, ctx as any);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(ctx.redis.kv.has('kwbot:seen:t1_abc')).toBe(true);
  });
});
