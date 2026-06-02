/**
 * CommentSubmit trigger handler.
 *
 * Flow (each step short-circuits cleanly so a no-op is cheap and silent):
 *   1. Load config; bail if disabled or the comment is unusable.
 *   2. Skip our own comments (never reply to ourselves → no loops).
 *   3. Match the body against the configured keyword rules.
 *   4. Idempotency: claim the comment id once (markIfNew) so retries/backfills
 *      can't double-reply.
 *   5. Cooldown: rate-limit the same user re-triggering the same keyword.
 *   6. Reply via the Reddit API and record stats.
 */
import type { TriggerContext } from '@devvit/public-api';
import type { CommentSubmit } from '@devvit/protos';
import { matchFirst, renderReply } from '../lib/keywords.js';
import { markIfNew, claimCooldown } from '../lib/dedup.js';
import { Stats } from '../lib/stats.js';
import { loadConfig } from '../settings.js';

export async function handleCommentSubmit(
  event: CommentSubmit,
  context: TriggerContext,
): Promise<void> {
  const comment = event.comment;
  const author = event.author?.name ?? comment?.author;

  // Need a comment with an id and body to do anything.
  if (!comment?.id || !comment.body || !author) return;

  // Never reply to ourselves — prevents the bot from triggering on its own posts.
  if (author === context.appName) return;

  const config = await loadConfig(context.settings);
  if (!config.enabled || config.rules.length === 0) return;

  const stats = new Stats(context.redis);
  await stats.incScanned();

  const { rule, matchedKeyword } = matchFirst(comment.body, config.rules);
  if (!rule || !matchedKeyword) return;

  // Idempotency: only the first handling of this exact comment proceeds.
  const isNew = await markIfNew(context.redis, comment.id);
  if (!isNew) return;

  // Cooldown: don't let one user spam the same keyword repeatedly.
  const allowed = await claimCooldown(
    context.redis,
    author,
    matchedKeyword,
    config.cooldownSeconds,
  );
  if (!allowed) return;

  const body = renderReply(config.template, {
    author,
    keyword: matchedKeyword,
    reply: rule.reply,
  });

  await context.reddit.submitComment({ id: comment.id, text: body });
  await stats.incReplied(matchedKeyword);

  console.log(`[kwbot] replied to ${comment.id} (u/${author}, keyword="${matchedKeyword}")`);
}
