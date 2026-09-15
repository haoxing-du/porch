import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestApp, login, call } from '../packages/test-support/src/server';
import type { Dispatch, HostEvent } from '../packages/contracts/src/index';
let f: Awaited<ReturnType<typeof createTestApp>>,
  alex: string,
  sam: string,
  workspace: string,
  topic: string,
  bot: string,
  host: string,
  project: string;
let delivered: Dispatch[];
beforeEach(async () => {
  f = await createTestApp();
  alex = await login(f.app, 'alex');
  sam = await login(f.app, 'sam');
  workspace = (await call(f.app, alex, 'POST', '/api/workspaces', { name: 'Friends' })).id;
  const invite = await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/invites`, {});
  await call(f.app, sam, 'POST', '/api/invites/join', { token: invite.token });
  topic = (await call(f.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`)).topics[0].id;
  const pairing = await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/pairings`, {});
  const paired = await call(f.app, '', 'POST', '/api/hosts/pair', {
    token: pairing.token,
    name: 'Alex Mac',
    version: '0.1.0',
  });
  host = paired.hostId;
  await f.app.relay.heartbeat(host, {
    type: 'heartbeat',
    version: 1,
    setupError: null,
    projects: [{ localId: crypto.randomUUID(), label: 'Recipes', available: true }],
  });
  project = (await call(f.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`)).projects[0]
    .id;
  bot = (
    await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/bots`, {
      name: 'SHODAN',
      handle: 'shodan',
      projectId: project,
      projectIds: [project],
      shared: true,
      trustConfirmed: true,
    })
  ).id;
  delivered = [];
  f.app.relay.connections.set(host, {
    send: (data: string) => {
      const payload = JSON.parse(data);
      if (payload.type === 'dispatch') delivered.push(payload);
    },
    readyState: 1,
    bufferedAmount: 0,
    close: () => {},
  } as never);
});
afterEach(async () => {
  await f?.close();
});
async function send(body: string, mention = true) {
  return call(f.app, alex, 'POST', `/api/topics/${topic}/messages`, {
    body,
    clientKey: crypto.randomUUID(),
    mentions: mention ? [{ id: bot, type: 'bot' }] : [],
  });
}
async function dispatch() {
  await f.db.query("UPDATE requests SET due_at=now() WHERE state='pending'");
  await f.app.relay.tick();
  return delivered.at(-1)!;
}
async function event(d: Dispatch, kind: HostEvent['kind'], extra: Partial<HostEvent> = {}) {
  await f.app.relay.acceptEvent(host, {
    type: 'event',
    eventId: crypto.randomUUID(),
    dispatchId: d.dispatchId,
    epoch: d.epoch,
    kind,
    ...extra,
  });
}
it('filters the real dispatch projection and resumes the same session for another member', async () => {
  await send('/nb HUMAN_ONLY_CANARY');
  expect((await f.db.query('SELECT * FROM bindings')).rows).toHaveLength(0);
  await send('Build a recipe page');
  const first = await dispatch();
  expect(first.context.messages).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain('CANARY');
  await event(first, 'accepted', { threadId: 'codex-thread' });
  await event(first, 'completed', {
    threadId: 'codex-thread',
    turnId: 'turn1',
    outcome: { kind: 'reply', text: 'Built it.' },
    itemId: 'final1',
  });
  await call(f.app, sam, 'POST', `/api/topics/${topic}/messages`, {
    body: 'Make it blue',
    clientKey: crypto.randomUUID(),
  });
  const second = await dispatch();
  expect(second.threadId).toBe('codex-thread');
  expect(second.sessionId).toBe(first.sessionId);
  expect(second.context.messages.find((m) => m.body === 'Make it blue')?.author.name).toBe('Sam');
  expect(JSON.stringify(second)).not.toContain('CANARY');
});
it('does not run offline requests after reconnect and requires explicit retry', async () => {
  f.app.relay.connections.delete(host);
  await f.db.query("UPDATE hosts SET last_seen=now()-interval '1 minute' WHERE id=$1", [host]);
  await send('Do this offline');
  await dispatch();
  expect(delivered).toHaveLength(0);
  await f.db.query('UPDATE hosts SET last_seen=now() WHERE id=$1', [host]);
  f.app.relay.connections.set(host, {
    send: (data: string) => {
      const p = JSON.parse(data);
      if (p.type === 'dispatch') delivered.push(p);
    },
    readyState: 1,
    bufferedAmount: 0,
    close: () => {},
  } as never);
  await dispatch();
  expect(delivered).toHaveLength(0);
  const session = (await f.db.query('SELECT id FROM agent_sessions')).rows[0].id;
  await call(f.app, sam, 'POST', `/api/sessions/${session}/action`, { action: 'retry' });
  await dispatch();
  expect(delivered).toHaveLength(1);
});
it('deduplicates accepted deliveries and bot output, and does not trigger bot loops', async () => {
  await send('Hello');
  const d = await dispatch();
  await event(d, 'accepted', { threadId: 'thread' });
  await event(d, 'completed', {
    outcome: { kind: 'reply', text: 'Hello humans.' },
    itemId: 'final',
  });
  await event(d, 'completed', {
    outcome: { kind: 'reply', text: 'Hello humans.' },
    itemId: 'final',
  });
  await dispatch();
  expect(
    (await call(f.app, alex, 'GET', `/api/topics/${topic}/messages`)).messages.filter(
      (m: { author: { type: string } }) => m.author.type === 'bot',
    ),
  ).toHaveLength(1);
  expect(delivered).toHaveLength(1);
});
it('fences stale output and leaves chat and files alone on fresh sessions', async () => {
  await send('Old request');
  const d = await dispatch();
  await event(d, 'accepted', { threadId: 'old-thread' });
  await call(f.app, sam, 'POST', `/api/sessions/${d.sessionId}/action`, {
    action: 'fresh',
    confirmed: true,
    projectId: project,
  });
  await event(d, 'completed', {
    outcome: { kind: 'reply', text: 'STALE OUTPUT' },
    itemId: 'old-final',
  });
  await send('New request');
  const fresh = await dispatch();
  expect(fresh.sessionId).not.toBe(d.sessionId);
  expect(fresh.threadId).toBeNull();
  expect(fresh.context.messages.map((m) => m.body)).toEqual(['New request']);
  const chat = await call(f.app, alex, 'GET', `/api/topics/${topic}/messages`);
  expect(JSON.stringify(chat)).toContain('Old request');
  expect(JSON.stringify(chat)).not.toContain('STALE OUTPUT');
});
it('dismisses, catches up with labeled background, and resumes after reinvitation', async () => {
  await send('First request');
  const d = await dispatch();
  await event(d, 'accepted', { threadId: 'thread' });
  await event(d, 'completed', { outcome: { kind: 'silent', text: '' }, itemId: 'silent' });
  await call(f.app, alex, 'POST', `/api/sessions/${d.sessionId}/action`, { action: 'dismiss' });
  await send('Discussion while dismissed', false);
  await send('/nobots REINVITE_CANARY', false);
  await dispatch();
  expect(delivered).toHaveLength(1);
  await send('Come back');
  const again = await dispatch();
  expect(again.threadId).toBe('thread');
  expect(again.context.messages.find((m) => m.body === 'Discussion while dismissed')?.purpose).toBe(
    'background',
  );
  expect(JSON.stringify(again)).not.toContain('CANARY');
});
it('does not acknowledge a disconnected stop and never silently replaces a lost session', async () => {
  await send('First request');
  const d = await dispatch();
  await event(d, 'accepted', { threadId: 'thread' });
  f.app.relay.connections.delete(host);
  await call(f.app, sam, 'POST', `/api/sessions/${d.sessionId}/action`, { action: 'stop' });
  expect(
    (await f.db.query('SELECT state FROM agent_sessions WHERE id=$1', [d.sessionId])).rows[0].state,
  ).toBe('stopping');
});
it('rejects unregistered project changes and owner-only bot configuration', async () => {
  await send('First');
  const d = await dispatch();
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/sessions/${d.sessionId}/action`,
        headers: { cookie: sam },
        payload: { action: 'fresh', confirmed: true, projectId: crypto.randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/bots/${bot}`,
        headers: { cookie: sam },
        payload: { enabled: false },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/sessions/${d.sessionId}/action`,
        headers: { cookie: alex },
        payload: { action: 'fresh', confirmed: true, path: '/etc' },
      })
    ).statusCode,
  ).toBe(400);
});
it('cancels accepted requests on stop and ignores their late result', async () => {
  await send('Start this');
  const d = await dispatch();
  await event(d, 'accepted', { threadId: 'thread' });
  await call(f.app, sam, 'POST', `/api/sessions/${d.sessionId}/action`, { action: 'stop' });
  expect(
    (await f.db.query('SELECT state FROM requests WHERE session_id=$1', [d.sessionId])).rows[0]
      .state,
  ).toBe('canceled');
  await event(d, 'completed', { outcome: { kind: 'reply', text: 'LATE RESULT' }, itemId: 'late' });
  expect(
    JSON.stringify(await call(f.app, alex, 'GET', `/api/topics/${topic}/messages`)),
  ).not.toContain('LATE RESULT');
});
