import { describe, it, expect, beforeEach } from 'vitest';
import {
  Stats,
  parseSnapshot,
  renderStats,
  type RedisLike,
  type StatsSnapshot,
} from '../src/lib/stats.js';

/** Minimal in-memory Redis-hash fake satisfying {@link RedisLike}. */
class FakeRedis implements RedisLike {
  private hashes = new Map<string, Map<string, number>>();

  async hIncrBy(key: string, field: string, value: number): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    const next = (hash.get(field) ?? 0) + value;
    hash.set(field, next);
    this.hashes.set(key, hash);
    return next;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries([...hash].map(([f, v]) => [f, String(v)]));
  }
}

describe('parseSnapshot', () => {
  it('returns zeroed counts for an empty hash', () => {
    expect(parseSnapshot({})).toEqual<StatsSnapshot>({
      scanned: 0,
      replied: 0,
      perKeyword: {},
    });
  });

  it('parses top-level counters and per-keyword fields', () => {
    const snap = parseSnapshot({
      scanned: '10',
      replied: '3',
      'kw:help': '2',
      'kw:bug': '1',
    });
    expect(snap).toEqual<StatsSnapshot>({
      scanned: 10,
      replied: 3,
      perKeyword: { help: 2, bug: 1 },
    });
  });

  it('treats malformed or negative values as zero', () => {
    const snap = parseSnapshot({ scanned: 'NaN', replied: '-5', 'kw:x': 'abc' });
    expect(snap).toEqual<StatsSnapshot>({
      scanned: 0,
      replied: 0,
      perKeyword: { x: 0 },
    });
  });
});

describe('Stats (with fake Redis)', () => {
  let stats: Stats;

  beforeEach(() => {
    stats = new Stats(new FakeRedis());
  });

  it('accumulates scanned and replied counts', async () => {
    await stats.incScanned();
    await stats.incScanned();
    await stats.incReplied('help');

    const snap = await stats.snapshot();
    expect(snap.scanned).toBe(2);
    expect(snap.replied).toBe(1);
    expect(snap.perKeyword).toEqual({ help: 1 });
  });

  it('tracks multiple keywords independently', async () => {
    await stats.incReplied('help');
    await stats.incReplied('help');
    await stats.incReplied('bug');

    const snap = await stats.snapshot();
    expect(snap.replied).toBe(3);
    expect(snap.perKeyword).toEqual({ help: 2, bug: 1 });
  });
});

describe('renderStats', () => {
  it('renders top-level counters', () => {
    const out = renderStats({ scanned: 5, replied: 2, perKeyword: {} });
    expect(out).toContain('Comments scanned:** 5');
    expect(out).toContain('Replies posted:** 2');
    expect(out).not.toContain('Replies by keyword');
  });

  it('lists per-keyword tallies sorted by count descending', () => {
    const out = renderStats({
      scanned: 9,
      replied: 6,
      perKeyword: { bug: 1, help: 4, docs: 1 },
    });
    const helpIdx = out.indexOf('`help`');
    const bugIdx = out.indexOf('`bug`');
    expect(helpIdx).toBeGreaterThan(-1);
    expect(helpIdx).toBeLessThan(bugIdx); // highest count appears first
  });
});
