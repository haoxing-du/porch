import { describe, it, expect } from 'vitest';
import { parseMessage, projectContext } from '../packages/contracts/src/index';
const message = (seq: number, body = `message ${seq}`, humanOnly = false) => ({id: `m${seq}`, seq, body, humanOnly, author: {id: 'alex', name: 'Alex', type: 'human' as const}, createdAt: '2026-09-15T00:00:00Z', mentions: [], attachments: []});
describe('human-only boundary', () => {
  it.each(['/nb', '/nobots', '  /nb'])('recognizes a standalone leading %s', prefix => {
    expect(parseMessage(`${prefix} secret`, false)).toEqual({body: 'secret', humanOnly: true});
  });
  it.each(['/nbfoo', 'hello /nb secret', '```\n/nb secret\n```'])('does not misclassify %s', body => {
    expect(parseMessage(body, false)).toEqual({body, humanOnly: false});
  });
  it('uses one bounded eligible projection for initial, catch-up, resume and fresh paths', () => {
    const canary = {...message(2, 'HUMAN_ONLY_CANARY', true), mentions: [{id: 'SECRET_BOT', type: 'bot' as const}], attachments: [{id: 'SECRET_FILE', name: 'SECRET_FILE', mediaType: 'text/plain', size: 2}]};
    for (const cursor of [0, 1, 2]) {
      const input = projectContext([message(1), canary, message(3)], {cursor, triggerSeqs: [3], maxMessages: 50, maxChars: 24000});
      expect(JSON.stringify(input)).not.toMatch(/SECRET|CANARY/);
      expect(input.messages.filter(m => m.id === 'm3')).toHaveLength(1);
    }
  });
  it('trims oldest background and reports omissions while keeping the request once', () => {
    const output = projectContext(Array.from({length: 60}, (_, i) => message(i + 1)), {cursor: 0, triggerSeqs: [60], maxMessages: 50, maxChars: 100});
    expect(output.omitted).toBe(true);
    expect(output.messages.at(-1)?.seq).toBe(60);
    expect(output.messages.reduce((n, m) => n + m.body.length, 0)).toBeLessThanOrEqual(100);
    expect(output.messages.at(-1)?.purpose).toBe('request');
  });
  it('rejects a request that cannot fit rather than dropping it', () => {
    expect(() => projectContext([message(1, 'long request')], {cursor: 0, triggerSeqs: [1], maxMessages: 50, maxChars: 2})).toThrow();
  });
});
