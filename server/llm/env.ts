// Server-side configuration for the assistant. Everything here is read from the server's
// environment (or an env file on the server's disk) and stays on the server: the browser
// only ever learns whether a model is available and what it is called.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Default model: the current Claude Opus. Override with LUNYX_LLM_MODEL. */
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_EFFORT: Effort = 'medium';
export const DEFAULT_MAX_TOKENS = 64_000;

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-fable-5-2': 'Claude Fable 5.2',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

export interface LlmConfig {
  /** 'none' means: no model, the browser runs its deterministic mode. */
  provider: 'anthropic' | 'codex' | 'scripted' | 'none';
  /** Why `provider` is 'none', as a sentence for the status endpoint. */
  reason?: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Hosted web search for the Codex provider. */
  webSearch?: 'live' | 'disabled';
  /** Server-side refusal fallback and thinking-binding controls (beta features of the Claude API). */
  betas: boolean;
  /** A custom API base URL is in use (a proxy or gateway). */
  customBaseUrl: boolean;
  router: string;
  /** Settings of the optional Jev router (TypeSafe AI); present when its key is configured. */
  jev?: { apiKey: string; model: string; simpleEffort: Effort; minConfidence: number; timeoutMs: number };
  /** Script name for the scripted test model. */
  script: string;
  /** Every secret value seen, for redaction of anything that leaves the server. */
  secrets: string[];
}

/**
 * Parses an env file: `KEY=value` lines, optional `export `, `#` comments, single or
 * double quotes. Deliberately small: no variable expansion, no multi-line values.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      // Unquoted: a ` #` starts a trailing comment.
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

const fileCache = new Map<string, { mtimeMs: number; values: Record<string, string> }>();

function readEnvFile(path: string): Record<string, string> {
  try {
    const { mtimeMs } = statSync(path);
    const hit = fileCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.values;
    const values = parseEnvFile(readFileSync(path, 'utf8'));
    fileCache.set(path, { mtimeMs, values });
    return values;
  } catch {
    return {};
  }
}

export interface EnvSource {
  processEnv: Record<string, string | undefined>;
  /** Project root: relative env file paths resolve against it. */
  root: string;
}

/**
 * The server's settings: process environment first, then the env file. The file is
 * LUNYX_ENV_FILE when set (absolute, or relative to the project root), otherwise
 * `.env.local` and `.env` in the project root when they exist. Both are git-ignored.
 * Re-read when the file changes, so adding a key does not need a restart.
 */
export function readSettings(src: EnvSource): { get(name: string): string | undefined; envFile: string | null; envFileMissing: boolean } {
  const explicit = src.processEnv.LUNYX_ENV_FILE?.trim();
  const candidates = explicit ? [isAbsolute(explicit) ? explicit : resolve(src.root, explicit)] : [resolve(src.root, '.env.local'), resolve(src.root, '.env')];
  const found = candidates.filter((p) => existsSync(p));
  // Earlier candidates win over later ones; the process environment wins over all files.
  const fileValues: Record<string, string> = {};
  for (const p of [...found].reverse()) Object.assign(fileValues, readEnvFile(p));
  return {
    get: (name) => {
      const fromProcess = src.processEnv[name];
      const v = fromProcess !== undefined && fromProcess !== '' ? fromProcess : fileValues[name];
      return v === undefined || v.trim() === '' ? undefined : v.trim();
    },
    envFile: found[0] ?? null,
    envFileMissing: Boolean(explicit) && found.length === 0,
  };
}

export function loadConfig(src: EnvSource = { processEnv: process.env, root: process.cwd() }): LlmConfig {
  const s = readSettings(src);
  const wanted = s.get('LUNYX_LLM_PROVIDER')?.toLowerCase();
  const effortRaw = s.get('LUNYX_LLM_EFFORT')?.toLowerCase() as Effort | undefined;
  const maxTokensRaw = Number(s.get('LUNYX_LLM_MAX_TOKENS'));
  const typesafeKey = s.get('TYPESAFE_API_KEY');
  const jevEffort = s.get('LUNYX_JEV_SIMPLE_EFFORT')?.toLowerCase() as Effort | undefined;
  const jevConfidence = Number(s.get('LUNYX_JEV_MIN_CONFIDENCE'));
  const jevTimeout = Number(s.get('LUNYX_JEV_TIMEOUT_MS'));

  const base = {
    model: s.get('LUNYX_LLM_MODEL') ?? (wanted === 'codex' ? 'default' : DEFAULT_MODEL),
    webSearch: s.get('LUNYX_WEB_SEARCH')?.toLowerCase() === 'disabled' ? 'disabled' as const : 'live' as const,
    effort: effortRaw && EFFORTS.includes(effortRaw) ? effortRaw : DEFAULT_EFFORT,
    maxTokens: Number.isInteger(maxTokensRaw) && maxTokensRaw >= 1024 && maxTokensRaw <= 128_000 ? maxTokensRaw : DEFAULT_MAX_TOKENS,
    betas: (s.get('LUNYX_LLM_BETAS') ?? 'on').toLowerCase() !== 'off',
    customBaseUrl: Boolean(s.get('ANTHROPIC_BASE_URL')),
    router: (s.get('LUNYX_LLM_ROUTER') ?? 'direct').toLowerCase(),
    ...(typesafeKey && {
      jev: {
        apiKey: typesafeKey,
        model: s.get('LUNYX_JEV_MODEL') ?? 'jev-latest',
        simpleEffort: jevEffort && EFFORTS.includes(jevEffort) ? jevEffort : ('low' as Effort),
        minConfidence: jevConfidence > 0 && jevConfidence <= 1 ? jevConfidence : 0.6,
        timeoutMs: Number.isInteger(jevTimeout) && jevTimeout >= 200 && jevTimeout <= 30_000 ? jevTimeout : 4000,
      },
    }),
    script: s.get('LUNYX_LLM_SCRIPT') ?? 'default',
    // The SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN itself; when one is set it is still
    // removed from anything that leaves the server, not only by the sk-ant- pattern.
    secrets: [s.get('ANTHROPIC_API_KEY'), s.get('ANTHROPIC_AUTH_TOKEN'), typesafeKey].filter((v): v is string => Boolean(v)),
  };

  if (wanted === 'off' || wanted === 'none' || wanted === 'deterministic') {
    return { ...base, provider: 'none', reason: 'The language model is switched off on this server (LUNYX_LLM_PROVIDER=off).' };
  }
  if (wanted === 'scripted') return { ...base, provider: 'scripted' };
  if (wanted === 'codex') return { ...base, provider: 'codex' };
  if (wanted !== undefined && wanted !== 'anthropic') {
    return { ...base, provider: 'none', reason: `Unknown LUNYX_LLM_PROVIDER "${wanted}". Use anthropic, codex, scripted or off.` };
  }
  // The Anthropic SDK resolves credentials itself: an `ant auth login` profile, workload
  // identity, or the ANTHROPIC_API_KEY env var. If none are found the provider creation
  // will fail and the handler reports no model available.
  return { ...base, provider: 'anthropic' };
}

/** Removes credentials from text that is about to leave the server (responses, logs). */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, '[redacted]');
}
