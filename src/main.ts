/**
 * App entry point.
 *
 * Wires the pure logic (src/lib) and handlers (src/handlers) into Devvit:
 *   - configure: enable Reddit API + Redis
 *   - settings:  installation-configurable keywords/template/cooldown
 *   - trigger:   CommentSubmit → handleCommentSubmit
 *   - scheduler: a heartbeat job, (re)scheduled on install/upgrade via cron
 *   - menu:      moderator actions to view and reset stats
 *
 * Devvit discovers the app by importing this module (see devvit.yaml / build).
 */
import { Devvit } from '@devvit/public-api';

import { SETTINGS } from './settings.js';
import { handleCommentSubmit } from './handlers/onComment.js';
import { handleHeartbeat, HEARTBEAT_JOB } from './handlers/onSchedule.js';
import { Stats, renderStats } from './lib/stats.js';

// Enable the platform capabilities this app uses.
Devvit.configure({
  redditAPI: true,
  redis: true,
});

// Installation-configurable settings (keywords, template, cooldown, on/off).
Devvit.addSettings(SETTINGS);

// Real-time path: respond to new comments.
Devvit.addTrigger({
  event: 'CommentSubmit',
  onEvent: handleCommentSubmit,
});

// Periodic heartbeat job. Defined here, scheduled on install/upgrade below.
Devvit.addSchedulerJob({
  name: HEARTBEAT_JOB,
  onRun: handleHeartbeat,
});

// (Re)schedule the heartbeat whenever the app is installed or upgraded.
// Cron: every 10 minutes. Cancels any stale copies first to stay idempotent.
async function scheduleHeartbeat(context: {
  scheduler: Devvit.Context['scheduler'];
}): Promise<void> {
  const jobs = await context.scheduler.listJobs();
  await Promise.all(
    jobs
      .filter((job) => job.name === HEARTBEAT_JOB)
      .map((job) => context.scheduler.cancelJob(job.id)),
  );
  await context.scheduler.runJob({ name: HEARTBEAT_JOB, cron: '*/10 * * * *' });
}

Devvit.addTrigger({
  events: ['AppInstall', 'AppUpgrade'],
  onEvent: async (_event, context) => {
    await scheduleHeartbeat(context);
    console.log('[kwbot] heartbeat scheduled (every 10 minutes)');
  },
});

// Moderator menu action: post the current stats as a comment-free toast + log.
Devvit.addMenuItem({
  label: 'Keyword Bot: Show stats',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const snapshot = await new Stats(context.redis).snapshot();
    context.ui.showToast(
      `Scanned ${snapshot.scanned} · Replied ${snapshot.replied}`,
    );
    console.log(`[kwbot] stats requested:\n${renderStats(snapshot)}`);
  },
});

// Moderator menu action: create a pinned-style stats post in the subreddit.
Devvit.addMenuItem({
  label: 'Keyword Bot: Post stats to subreddit',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const snapshot = await new Stats(context.redis).snapshot();
    await context.reddit.submitPost({
      subredditName: subreddit.name,
      title: '🤖 Keyword Bot — Stats',
      text: renderStats(snapshot),
    });
    context.ui.showToast('Posted stats to the subreddit.');
  },
});

export default Devvit;
