/**
 * Scheduler job handler — a periodic heartbeat / housekeeping tick.
 *
 * Triggers handle the real-time path; this scheduled job exists to:
 *   - prove liveness (a log line on every tick, visible in `devvit logs`), and
 *   - provide a place for periodic maintenance (e.g. emitting a stats summary).
 *
 * Note: `JobContext` has no `ui` — scheduled jobs run server-side with no user
 * surface, so this handler only touches redis/reddit/logging, never `context.ui`.
 */
import type { JobContext, ScheduledJobEvent } from '@devvit/public-api';
import { Stats, renderStats } from '../lib/stats.js';

/** The registered name of the scheduled job; shared with main.ts. */
export const HEARTBEAT_JOB = 'kwbot-heartbeat';

export async function handleHeartbeat(
  _event: ScheduledJobEvent<undefined>,
  context: JobContext,
): Promise<void> {
  const stats = new Stats(context.redis);
  const snapshot = await stats.snapshot();
  // Single structured log line per tick — cheap, and confirms the job is alive.
  console.log(
    `[kwbot] heartbeat — scanned=${snapshot.scanned} replied=${snapshot.replied}`,
  );
  // Render is exercised here too so the formatting path stays warm/visible in logs.
  console.debug(renderStats(snapshot));
}
