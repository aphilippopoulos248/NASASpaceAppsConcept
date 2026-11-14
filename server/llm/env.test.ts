import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EFFORT, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, loadConfig, modelLabel, parseEnvFile, redact } from './env';

const KEY = 'sk-ant-test-CANARY-0123456789abcdef';
const emptyRoot = () => mkdtempSync(join(tmpdir(), 'lunyx-env-'));

describe('env file parsing', () => {
  it('reads KEY=value lines with comments, quotes and export', () => {
    expect(
      parseEnvFile(['# a comment', '', 'A=1', 'export B = two words ', 'C="quoted # not a comment"', "D='single'", 'E=value # trailing comment', 'not a line', 'F='].join('\n')),
    ).toEqual({ A: '1', B: 'two words', C: 'quoted # not a comment', D: 'single', E: 'value', F: '' });
  });
});

describe('assistant server configuration', () => {
  it('has no model without a key, and says how to add one', () => {
    const cfg = loadConfig({ processEnv: {}, root: emptyRoot() });
    expect(cfg.provider).toBe('none');
    expect(cfg.reason).toContain('ANTHROPIC_API_KEY');
    expect(cfg.secrets).toEqual([]);
  });

  it('uses the key from the process environment with the default model and effort', () => {
    const cfg = loadConfig({ processEnv: { ANTHROPIC_API_KEY: KEY }, root: emptyRoot() });
    expect(cfg).toMatchObject({ provider: 'anthropic', apiKey: KEY, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS, betas: true, router: 'direct' });
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(modelLabel(cfg.model)).toBe('Claude Opus 5.5');
    expect(cfg.secrets).toEqual([KEY]);
  });

  it('reads .env.local, then .env, and lets the process environment win', () => {
    const root = emptyRoot();
    writeFileSync(join(root, '.env'), `ANTHROPIC_API_KEY=${KEY}-from-env\nLUNYX_LLM_MODEL=claude-sonnet-5-5\nLUNYX_LLM_EFFORT=low\n`);
    expect(loadConfig({ processEnv: {}, root })).toMatchObject({ provider: 'anthropic', apiKey: `${KEY}-from-env`, model: 'claude-sonnet-5-5', effort: 'low' });
    writeFileSync(join(root, '.env.local'), `ANTHROPIC_API_KEY=${KEY}-local\n`);
    expect(loadConfig({ processEnv: {}, root })).toMatchObject({ apiKey: `${KEY}-local`, model: 'claude-sonnet-5-5' });
    expect(loadConfig({ processEnv: { ANTHROPIC_API_KEY: KEY, LUNYX_LLM_MODEL: 'claude-fable-5-2' }, root })).toMatchObject({ apiKey: KEY, model: 'claude-fable-5-2' });
  });

  it('reads an explicit env file path, relative to the project root or absolute', () => {
    const root = emptyRoot();
    writeFileSync(join(root, 'secrets.env'), `export ANTHROPIC_API_KEY="${KEY}"\n`);
    expect(loadConfig({ processEnv: { LUNYX_ENV_FILE: 'secrets.env' }, root })).toMatchObject({ provider: 'anthropic', apiKey: KEY });
    expect(loadConfig({ processEnv: { LUNYX_ENV_FILE: join(root, 'secrets.env') }, root: emptyRoot() })).toMatchObject({ provider: 'anthropic', apiKey: KEY });
    const missing = loadConfig({ processEnv: { LUNYX_ENV_FILE: 'nope.env' }, root });
    expect(missing.provider).toBe('none');
    expect(missing.reason).toContain('LUNYX_ENV_FILE');
  });

  it('can be switched off, scripted, or pointed at the SDK credential chain', () => {
    const root = emptyRoot();
    expect(loadConfig({ processEnv: { ANTHROPIC_API_KEY: KEY, LUNYX_LLM_PROVIDER: 'off' }, root })).toMatchObject({ provider: 'none' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_SCRIPT: 'scenario' }, root })).toMatchObject({ provider: 'scripted', script: 'scenario' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_AUTH: 'profile' }, root })).toMatchObject({ provider: 'anthropic', sdkCredentials: true, apiKey: undefined });
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'gpt' }, root }).reason).toContain('Unknown LUNYX_LLM_PROVIDER');
    expect(loadConfig({ processEnv: { ANTHROPIC_AUTH_TOKEN: 'token-abcdefgh' }, root })).toMatchObject({ provider: 'anthropic', authToken: 'token-abcdefgh', secrets: ['token-abcdefgh'] });
  });

  it('ignores invalid effort and token settings', () => {
    const cfg = loadConfig({ processEnv: { ANTHROPIC_API_KEY: KEY, LUNYX_LLM_EFFORT: 'turbo', LUNYX_LLM_MAX_TOKENS: '12', LUNYX_LLM_BETAS: 'off', LUNYX_LLM_ROUTER: 'Jev' }, root: emptyRoot() });
    expect(cfg).toMatchObject({ effort: DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS, betas: false, router: 'jev' });
    expect(loadConfig({ processEnv: { ANTHROPIC_API_KEY: KEY, LUNYX_LLM_EFFORT: 'HIGH', LUNYX_LLM_MAX_TOKENS: '32000' }, root: emptyRoot() })).toMatchObject({ effort: 'high', maxTokens: 32000 });
  });
});

describe('redaction', () => {
  it('removes known secrets and anything shaped like a key', () => {
    expect(redact(`bad key ${KEY} here`, [KEY])).toBe('bad key [redacted] here');
    expect(redact('leaked sk-ant-api03-AbCdEf_123456 in text', [])).toBe('leaked [redacted] in text');
    expect(redact('nothing secret', [KEY])).toBe('nothing secret');
  });
});
