import { describe, expect, it, vi } from 'vitest';
import { appConfig, CodexProvider, conversationText, type CodexConnection } from './codex';
import { loadConfig } from './env';
import type { ProviderRequest } from './types';
import type { StepEvent } from '../../src/assistant/protocol';

const cfg = () => loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'codex' }, root: '/nonexistent-lunyx-root' });
const request = (): ProviderRequest => ({ system: 'Lunyx instructions', signal: new AbortController().signal,
  messages: [{ role: 'user', text: 'Show the sunlight overlay.', state: { view: 'globe' } }],
  tools: [{ name: 'setOverlay', description: 'Set overlay', input_schema: { type: 'object', properties: { mode: { type: 'string' } } } }],
});
function fake(events: any[] = [], account: unknown = { type: 'chatgpt' }): CodexConnection {
  return {
    initialize: vi.fn(async () => {}), close: vi.fn(), send: vi.fn(),
    call: vi.fn(async (method) => {
      if (method === 'account/read') return { account };
      if (method === 'config/read') return { config: { mcp_servers: { personal: {} } } };
      if (method === 'thread/start') return { thread: { id: 'thread1' }, model: 'available-model' };
      return {};
    }),
    async *events() { yield* events; },
  };
}
async function collect(p: CodexProvider, r = request()) {
  const events: StepEvent[] = [];
  for await (const e of p.step(r)) events.push(e);
  return events;
}

describe('Codex subscription provider', () => {
  it('is opt in and preserves the Claude default and model settings', () => {
    expect(cfg()).toMatchObject({ provider: 'codex', model: 'default' });
    expect(loadConfig({ processEnv: {}, root: '/nonexistent-lunyx-root' })).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'codex', LUNYX_LLM_MODEL: 'my-model' }, root: '/nonexistent-lunyx-root' }).model).toBe('my-model');
  });
  it('requires a ChatGPT login rather than silently charging an API key', async () => {
    for (const account of [null, { type: 'apiKey' }]) {
      const rpc = fake([], account);
      expect(await new CodexProvider(cfg(), () => rpc).ready()).toContain('npx codex login');
      expect(rpc.close).toHaveBeenCalled();
    }
    expect(await new CodexProvider(cfg(), () => fake()).ready()).toBeNull();
  });
  it('streams a native action to the browser and closes the pending Codex thread', async () => {
    const rpc = fake([
      { method: 'item/agentMessage/delta', params: { delta: 'Showing it.' } },
      { method: 'item/tool/call', id: 40, params: { tool: 'setOverlay', callId: 'c1', arguments: { mode: 'sun-band' } } },
    ]);
    const events = await collect(new CodexProvider(cfg(), () => rpc));
    expect(events.at(-1)).toMatchObject({ type: 'done', stop: 'tool_calls', message: { text: 'Showing it.', toolCalls: [{ id: 'c1', name: 'setOverlay', input: { mode: 'sun-band' } }] } });
    expect(rpc.call).toHaveBeenCalledWith('thread/start', expect.objectContaining({ ephemeral: true, sandbox: 'read-only', dynamicTools: [expect.objectContaining({ name: 'setOverlay' })] }));
    expect(rpc.close).toHaveBeenCalled();
  });
  it('replays app state and actual action results without opaque Claude blocks', () => {
    const text = conversationText([
      ...request().messages,
      { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'setOverlay', input: { mode: 'sun-band' } }], provider: { id: 'anthropic', blocks: 'opaque' } },
      { role: 'tool', results: [{ id: 'c1', name: 'setOverlay', ok: true, content: '{"mode":"sun-band"}' }] },
    ]);
    expect(text).toContain('app_state');
    expect(text).toContain('sun-band');
    expect(text).not.toContain('opaque');
  });
  it('returns a final answer and rejects unknown actions without exposing diagnostics', async () => {
    const rpc = fake([{ method: 'item/agentMessage/delta', params: { delta: 'Done.' } }, { method: 'turn/completed', params: { turn: { status: 'completed' } } }]);
    expect((await collect(new CodexProvider(cfg(), () => rpc))).at(-1)).toMatchObject({ type: 'done', stop: 'end', message: { text: 'Done.', toolCalls: [] } });
    const bad = fake([{ method: 'item/tool/call', id: 4, params: { tool: 'unknown', callId: 'c1', arguments: {} } }]);
    expect((await collect(new CodexProvider(cfg(), () => bad))).at(-1)).toMatchObject({ type: 'error' });
    expect(bad.close).toHaveBeenCalled();
  });
  it('disables inherited personal integrations and shell tools', () => {
    expect(appConfig({ mcp_servers: { work: {} }, plugins: { 'personal@local': {} } })).toMatchObject({
      'mcp_servers.work.enabled': false, 'plugins.personal@local.enabled': false,
      'features.shell_tool': false, web_search: 'disabled', 'hooks.SessionStart': [],
    });
  });
});
