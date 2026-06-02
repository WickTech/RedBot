# 🤖 Reddit Keyword Bot

A keyword auto-responder for Reddit, built on **[Devvit](https://developers.reddit.com/)**
(Reddit's official Developer Platform). It watches a subreddit, replies **exactly once** to
comments that match moderator-configured keywords, enforces a per-user cooldown, and tracks
stats — all running *inside* Reddit on the free tier, with no external server to host.

> **Why Devvit (and not the classic Data API + PRAW)?**
> As of Reddit's 2025 *Responsible Builder Policy*, the public Data API requires per-app
> pre-approval (typically 2–4 weeks) even for personal bots, and blocks non-OAuth traffic.
> Devvit apps run on Reddit's platform with a much faster approval path, a free managed
> backend (Redis + Scheduler + Reddit API), and no API keys to rotate. For a bot that
> operates within a subreddit, it's the modern, recommended path.

---

## What it does

| Capability | How |
|---|---|
| **Real-time replies** | `CommentSubmit` trigger → keyword match → reply |
| **Exactly-once** | Redis `SET NX` keyed by comment id — retries/backfills can't double-reply |
| **Anti-spam** | Per-user, per-keyword cooldown (Redis TTL) |
| **Configurable** | Moderators set keywords, reply template, cooldown, on/off via app settings |
| **Observability** | Scheduled heartbeat job logs liveness + stats every 10 min |
| **Moderator tools** | Menu actions to view stats (toast) and post a stats summary |

## Architecture

```
                      Reddit (a subreddit where the app is installed)
                                     │
          new comment ───────────────┤ CommentSubmit trigger
                                     ▼
                          ┌──────────────────────┐
                          │  src/handlers         │   orchestration (I/O)
                          │  • onComment.ts       │
                          │  • onSchedule.ts      │
                          └───────────┬───────────┘
                                      │ uses
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
      ┌───────────────┐      ┌────────────────┐      ┌────────────────┐
      │ lib/keywords  │      │  lib/dedup     │      │  lib/stats     │   pure logic
      │ match/parse/  │      │  markIfNew /   │      │  counters +    │   (no Devvit
      │ renderReply   │      │  claimCooldown │      │  renderStats   │    imports →
      └───────────────┘      └───────┬────────┘      └───────┬────────┘    unit-tested)
                                     │                       │
                                     ▼                       ▼
                              ┌─────────────────────────────────┐
                              │   Devvit Redis (managed, free)   │
                              └─────────────────────────────────┘
```

**Design principle — push correctness into infrastructure, not handler code.** Idempotency is
a single `SET NX` on the comment id ([`src/lib/dedup.ts`](src/lib/dedup.ts)); the handler stays a
thin, readable pipeline. The decision logic (keyword matching, template rendering, stats
aggregation) is pure and lives in [`src/lib/`](src/lib/) with **no Devvit imports**, so it's
fully unit-testable with in-memory fakes.

### Layout
```
src/
  main.ts              # entry: configure + register settings/trigger/scheduler/menu
  settings.ts          # settings schema + typed loadConfig()
  handlers/
    onComment.ts       # CommentSubmit → match → dedup → cooldown → reply → stats
    onSchedule.ts      # heartbeat / housekeeping tick
  lib/
    keywords.ts        # parseRules, matchFirst, renderReply  (pure)
    dedup.ts           # markIfNew, claimCooldown             (Redis, injectable)
    stats.ts           # Stats, parseSnapshot, renderStats    (Redis, injectable)
test/                  # vitest unit tests for all of lib/
```

## Getting started

> **Prerequisites:** Node 18+ and a Reddit account. You'll create a small **test subreddit**
> you moderate (Reddit → *Create a Community*) to play-test the app.

```bash
npm install

# 1. Log in to Reddit (opens an OAuth flow in your browser)
npm run login

# 2. Pick a globally-unique app name in devvit.yaml, then upload to register the app
npm run devvit:init      # = devvit upload

# 3. Live-develop against your test subreddit
npm run dev -- <your-test-subreddit>   # = devvit playtest
```

Once installed, open the subreddit's app settings to configure keyword rules, e.g.:

```
refund => See our refund policy in the sidebar.
bug    => Please report bugs on our issue tracker.
```

## Configuration (app settings)

| Setting | Type | Default | Purpose |
|---|---|---|---|
| Enable the bot | boolean | on | Master on/off switch |
| Keyword rules | paragraph | — | `keyword => reply` lines (`#` comments allowed) |
| Reply template | paragraph | built-in | Wraps replies. Tokens: `{{author}}`, `{{keyword}}`, `{{reply}}` |
| Cooldown (seconds) | number | 600 | Per-user, per-keyword rate limit |

## Testing

```bash
npm test          # run the unit suite (vitest)
npm run typecheck # tsc --noEmit against Devvit's real types
```

The suite covers the keyword parser/matcher (incl. regex-special keywords like `c++`,
whole-word boundaries, punctuation), the idempotency + cooldown logic (via an in-memory Redis
fake that mirrors `SET NX` + TTL semantics), and stats aggregation/rendering.

## Notes & limitations
- Devvit is a **managed serverless platform**: there's no container/queue/CI-to-cloud here by
  design. For a bot that lives inside a subreddit, that's the point — Reddit hosts it for free.
- The bot never replies to its own comments (guards against reply loops).
- Local `playtest`/`upload` require Reddit auth; backend features (Redis, triggers) only run
  when installed on Reddit, not in any offline preview.

## Development environment note
This project lives on the WSL filesystem. Run `npm`/`devvit` **from inside WSL** (native Linux
paths), not from a Windows `\\wsl.localhost\...` UNC path — a transitive postinstall script
shells out via `cmd.exe`, which cannot run from a UNC working directory.

## License
MIT
