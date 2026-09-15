import { describe, it, expect } from 'vitest';
import { decodeOutcome, validateRequest } from '../packages/codex-adapter/src/index';
describe('pinned Codex adapter', () => {
  it('validates invocation policy against the generated runtime schema', () => {
    expect(() =>
      validateRequest('thread/start', {
        cwd: '/tmp/test',
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      }),
    ).not.toThrow();
    expect(() =>
      validateRequest('thread/start', {
        cwd: '/tmp/test',
        approvalPolicy: 'always',
        sandbox: 'made-up',
      }),
    ).toThrow();
    expect(() =>
      validateRequest('turn/start', {
        threadId: 'test',
        input: [{ type: 'text', text: 'hello' }],
        outputSchema: { type: 'object' },
      }),
    ).not.toThrow();
  });
  it('publishes only a validated final envelope, not reasoning or commentary', () => {
    const turn = {
      items: [
        { type: 'reasoning', text: 'private' },
        { type: 'agentMessage', phase: 'commentary', text: 'working' },
        {
          id: 'final',
          type: 'agentMessage',
          phase: 'final_answer',
          text: '{"kind":"reply","text":"Done."}',
        },
      ],
    };
    expect(decodeOutcome(turn)).toEqual({ kind: 'reply', text: 'Done.' });
  });
  it('distinguishes waiting and silence without guessing at prose', () => {
    expect(
      decodeOutcome({
        items: [
          { type: 'agentMessage', phase: 'final_answer', text: '{"kind":"silent","text":""}' },
        ],
      }).kind,
    ).toBe('silent');
    expect(
      decodeOutcome({
        items: [
          {
            type: 'agentMessage',
            phase: 'final_answer',
            text: '{"kind":"wait","text":"Which color?"}',
          },
        ],
      }).kind,
    ).toBe('wait');
    expect(() =>
      decodeOutcome({
        items: [{ type: 'agentMessage', phase: 'final_answer', text: 'I will stay silent.' }],
      }),
    ).toThrow();
  });
});
