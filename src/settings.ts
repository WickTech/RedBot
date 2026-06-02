/**
 * App settings: the installation-configurable knobs, and a typed accessor that
 * reads them from `context.settings` and turns them into validated runtime config.
 *
 * Settings are defined declaratively via `SETTINGS` (registered in main.ts with
 * `Devvit.addSettings`) and read via {@link loadConfig}. Keeping the schema and
 * the loader together makes the contract between "what the moderator configures"
 * and "what the handlers consume" easy to audit.
 */
import type { SettingsFormField } from '@devvit/public-api';
import { parseRules, type KeywordRule } from './lib/keywords.js';

/** Setting names. Centralized so the schema and loader can't drift apart. */
export const SettingKey = {
  Rules: 'keyword-rules',
  ReplyTemplate: 'reply-template',
  CooldownSeconds: 'reply-cooldown-seconds',
  Enabled: 'enabled',
} as const;

/** Default reply template, used when the moderator leaves the field blank. */
const DEFAULT_TEMPLATE =
  'Hi u/{{author}} — you mentioned **{{keyword}}**.\n\n{{reply}}\n\n' +
  '*^(I am a bot. This action was performed automatically.)*';

/** Default per-user, per-keyword cooldown (seconds) to avoid spamming. */
const DEFAULT_COOLDOWN_SECONDS = 600;

/**
 * The installation settings schema. Registered once in main.ts.
 *
 * These are 'installation' scope (the default): each subreddit that installs the
 * app configures its own keywords, template, and cooldown.
 */
export const SETTINGS: SettingsFormField[] = [
  {
    type: 'boolean',
    name: SettingKey.Enabled,
    label: 'Enable the bot (turn off to pause all replies)',
    defaultValue: true,
  },
  {
    type: 'paragraph',
    name: SettingKey.Rules,
    label: 'Keyword rules — one per line, in the form:  keyword => reply text',
    helpText:
      'Example:\n  refund => See our refund policy in the sidebar.\n  bug => Please report bugs on our issue tracker.',
  },
  {
    type: 'paragraph',
    name: SettingKey.ReplyTemplate,
    label: 'Reply template. Tokens: {{author}}, {{keyword}}, {{reply}}',
    helpText: 'Leave blank to use the default template.',
  },
  {
    type: 'number',
    name: SettingKey.CooldownSeconds,
    label: 'Per-user cooldown per keyword (seconds)',
    helpText: 'How long before the same user can trigger the same keyword again.',
    defaultValue: DEFAULT_COOLDOWN_SECONDS,
  },
];

/** Validated, ready-to-use runtime configuration derived from settings. */
export interface BotConfig {
  readonly enabled: boolean;
  readonly rules: KeywordRule[];
  readonly template: string;
  readonly cooldownSeconds: number;
}

/** The minimal slice of `context.settings` that {@link loadConfig} needs. */
export interface SettingsReader {
  get<T = string | string[] | boolean | number>(name: string): Promise<T | undefined>;
}

/**
 * Read settings and produce a {@link BotConfig}.
 *
 * Applies sensible defaults and clamps so a misconfigured installation can never
 * crash a handler: blank template → default, missing/negative cooldown → default.
 */
export async function loadConfig(settings: SettingsReader): Promise<BotConfig> {
  const [enabled, rawRules, rawTemplate, rawCooldown] = await Promise.all([
    settings.get<boolean>(SettingKey.Enabled),
    settings.get<string>(SettingKey.Rules),
    settings.get<string>(SettingKey.ReplyTemplate),
    settings.get<number>(SettingKey.CooldownSeconds),
  ]);

  const template = (rawTemplate ?? '').trim() || DEFAULT_TEMPLATE;
  const cooldownSeconds =
    typeof rawCooldown === 'number' && rawCooldown >= 0
      ? Math.floor(rawCooldown)
      : DEFAULT_COOLDOWN_SECONDS;

  return {
    enabled: enabled !== false, // default ON unless explicitly disabled
    rules: parseRules(rawRules ?? ''),
    template,
    cooldownSeconds,
  };
}
