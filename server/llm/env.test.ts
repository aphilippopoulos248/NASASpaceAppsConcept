import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, loadConfig, modelLabel, parseEnvFile, redact } from './env';

const emptyRoot = () => mkdtempSync(join(tmpdir(), 'lunyx-env-'));

describe('env file parsing', () => {
  it('reads KEY=value lines with comments, quotes and export', () => {
    expect(
      parseEnvFile(['# a comment', '', 'A=1', 'export B = two words ', 'C="quoted # not a comment"', "D='single'", 'E=value # trailing comment', 'not a line', 'F='].join('\n')),
    ).toEqual({ A: '1', B: 'two words', C: 'quoted # not a comment', D: 'single', E: 'value', F: '' });
  });
});

describe('assistant server configuration', () => {
  it('defaults to the anthropic provider, letting the SDK resolve credentials', () => {
    const cfg = loadConfig({ processEnv: {}, root: emptyRoot() });
    expect(cfg).toMatchObject({ provider: 'anthropic', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS, betas: true, router: 'direct' });
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(modelLabel(cfg.model)).toBe('Claude Opus 5.5');
    expect(cfg.secrets).toEqual([]);
  });

  it('reads .env.local, then .env, and lets the process environment win', () => {
    const root = emptyRoot();
    writeFileSync(join(root, '.env'), `LUNYX_LLM_MODEL=claude-sonnet-5-5\nLUNYX_LLM_EFFORT=low\n`);
    expect(loadConfig({ processEnv: {}, root })).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' });
    writeFileSync(join(root, '.env.local'), `LUNYX_LLM_MODEL=claude-haiku-5-5\n`);
    expect(loadConfig({ processEnv: {}, root })).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_MODEL: 'claude-fable-5-2' }, root })).toMatchObject({ model: 'claude-fable-5-2' });
  });

  it('reads an explicit env file path, relative to the project root or absolute', () => {
    const root = emptyRoot();
    writeFileSync(join(root, 'settings.env'), `LUNYX_LLM_MODEL=claude-fable-5-2\n`);
    expect(loadConfig({ processEnv: { LUNYX_ENV_FILE: 'settings.env' }, root })).toMatchObject({ provider: 'anthropic', model: 'claude-fable-5-2' });
    expect(loadConfig({ processEnv: { LUNYX_ENV_FILE: join(root, 'settings.env') }, root: emptyRoot() })).toMatchObject({ provider: 'anthropic', model: 'claude-fable-5-2' });
  });

  it('can be switched off or scripted', () => {
    const root = emptyRoot();
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'off' }, root })).toMatchObject({ provider: 'none' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_SCRIPT: 'scenario' }, root })).toMatchObject({ provider: 'scripted', script: 'scenario' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'gpt' }, root }).reason).toContain('Unknown LUNYX_LLM_PROVIDER');
  });

  it('ignores invalid effort and token settings', () => {
    const cfg = loadConfig({ processEnv: { LUNYX_LLM_EFFORT: 'turbo', LUNYX_LLM_MAX_TOKENS: '12', LUNYX_LLM_BETAS: 'off', LUNYX_LLM_ROUTER: 'Jev' }, root: emptyRoot() });
    expect(cfg).toMatchObject({ effort: DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS, betas: false, router: 'jev' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_EFFORT: 'HIGH', LUNYX_LLM_MAX_TOKENS: '32000' }, root: emptyRoot() })).toMatchObject({ effort: 'high', maxTokens: 32000 });
  });
});

describe('redaction', () => {
  it('removes known secrets and anything shaped like a key', () => {
    const KEY = 'sk-ant-test-CANARY-0123456789abcdef';
    expect(redact(`bad key ${KEY} here`, [KEY])).toBe('bad key [redacted] here');
    expect(redact('leaked sk-ant-api03-AbCdEf_123456 in text', [])).toBe('leaked [redacted] in text');
    expect(redact('nothing secret', [KEY])).toBe('nothing secret');
  });
});

describe('credentials the SDK reads itself are still redacted (7dabe03 left only the sk-ant- pattern)', () => {
  it('keeps an explicit ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN among the secrets', () => {
    const cfg = loadConfig({ processEnv: { ANTHROPIC_API_KEY: 'plain-key-CANARY-1', ANTHROPIC_AUTH_TOKEN: 'token-CANARY-2' }, root: '/nonexistent-lunyx-root' });
    expect(cfg.secrets).toEqual(expect.arrayContaining(['plain-key-CANARY-1', 'token-CANARY-2']));
    expect(redact('failed with plain-key-CANARY-1 and token-CANARY-2', cfg.secrets)).toBe('failed with [redacted] and [redacted]');
    expect(loadConfig({ processEnv: {}, root: '/nonexistent-lunyx-root' }).secrets).toEqual([]);
  });
});
