import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createTestApp, login, call } from '../packages/test-support/src/server';
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let alex: string, sam: string, outsider: string, workspace: string, topic: string;
beforeAll(async () => {
  fixture = await createTestApp();
  alex = await login(fixture.app, 'alex');
  sam = await login(fixture.app, 'sam');
  outsider = await login(fixture.app, 'outsider');
});
afterAll(async () => {
  await fixture?.close();
});
describe('persistent authorized chat', () => {
  it('creates a workspace, joins with an invite, and creates a topic', async () => {
    const w = await call(fixture.app, alex, 'POST', '/api/workspaces', { name: 'Friends' });
    workspace = w.id;
    const invite = await call(
      fixture.app,
      alex,
      'POST',
      `/api/workspaces/${workspace}/invites`,
      {},
    );
    await call(fixture.app, sam, 'POST', '/api/invites/join', { token: invite.token });
    const channel = await call(fixture.app, sam, 'POST', `/api/workspaces/${workspace}/channels`, {
      name: 'builds',
    });
    topic = (
      await call(fixture.app, sam, 'POST', `/api/channels/${channel.id}/topics`, {
        title: 'Recipe app',
      })
    ).id;
  });
  it('orders concurrent messages and deduplicates retried sends', async () => {
    const key = crypto.randomUUID();
    const body = { body: 'Hello Sam', clientKey: key };
    const sent = await call(fixture.app, alex, 'POST', `/api/topics/${topic}/messages`, body);
    const retry = await call(fixture.app, alex, 'POST', `/api/topics/${topic}/messages`, body);
    expect(retry.id).toBe(sent.id);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        call(fixture.app, sam, 'POST', `/api/topics/${topic}/messages`, {
          body: `reply ${i}`,
          clientKey: crypto.randomUUID(),
        }),
      ),
    );
    const history = await call(fixture.app, sam, 'GET', `/api/topics/${topic}/messages`);
    expect(history.messages).toHaveLength(9);
    expect(history.messages.map((m: { seq: number }) => m.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    await fixture.restart();
    expect(
      (await call(fixture.app, sam, 'GET', `/api/topics/${topic}/messages`)).messages,
    ).toHaveLength(9);
  });
  it('denies non-members history, subscriptions, sends, and uploads', async () => {
    for (const url of [
      `/api/topics/${topic}/messages`,
      `/api/workspaces/${workspace}/snapshot`,
      `/api/workspaces/${workspace}/events`,
    ]) {
      expect(
        (await fixture.app.inject({ method: 'GET', url, headers: { cookie: outsider } }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await fixture.app.inject({
          method: 'POST',
          url: `/api/topics/${topic}/messages`,
          headers: { cookie: outsider },
          payload: { body: 'intrude', clientKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('persists human-only messages without treating near matches as prefixes', async () => {
    const sent = await call(fixture.app, alex, 'POST', `/api/topics/${topic}/messages`, {
      body: ' /nobots a secret',
      clientKey: crypto.randomUUID(),
    });
    expect(sent.humanOnly).toBe(true);
    expect(sent.body).toBe('a secret');
    const ordinary = await call(fixture.app, alex, 'POST', `/api/topics/${topic}/messages`, {
      body: '/nbfoo',
      clientKey: crypto.randomUUID(),
    });
    expect(ordinary.humanOnly).toBe(false);
  });
  it('keeps read cursors monotonic and shared between browser sessions', async () => {
    await call(fixture.app, sam, 'POST', `/api/topics/${topic}/read`, { seq: 9 });
    await call(fixture.app, sam, 'POST', `/api/topics/${topic}/read`, { seq: 2 });
    const snapshot = await call(fixture.app, sam, 'GET', `/api/workspaces/${workspace}/snapshot`);
    expect(snapshot.topics.find((t: { id: string }) => t.id === topic).readSeq).toBe(9);
  });
  it('rejects revoked invites and removes access for a removed member', async () => {
    const invite = await call(
      fixture.app,
      alex,
      'POST',
      `/api/workspaces/${workspace}/invites`,
      {},
    );
    await call(fixture.app, alex, 'DELETE', `/api/workspaces/${workspace}/invites/${invite.id}`);
    expect(
      (
        await fixture.app.inject({
          method: 'POST',
          url: '/api/invites/join',
          headers: { cookie: outsider },
          payload: { token: invite.token },
        })
      ).statusCode,
    ).toBe(410);
    const me = await call(fixture.app, sam, 'GET', '/api/me');
    await call(fixture.app, alex, 'DELETE', `/api/workspaces/${workspace}/members/${me.user.id}`);
    expect(
      (await fixture.app.inject({ url: `/api/topics/${topic}/messages`, headers: { cookie: sam } }))
        .statusCode,
    ).toBe(403);
  });
});
it('loads an old message permalink with a bounded surrounding page', async () => {
  const current = (await call(fixture.app, alex, 'GET', `/api/topics/${topic}/messages`))
    .messages[0];
  for (let i = 0; i < 55; i++)
    await call(fixture.app, alex, 'POST', `/api/topics/${topic}/messages`, {
      body: `pagination ${i}`,
      clientKey: crypto.randomUUID(),
    });
  const around = await call(
    fixture.app,
    alex,
    'GET',
    `/api/topics/${topic}/messages?around=${current.id}`,
  );
  expect(around.messages.some((m: { id: string }) => m.id === current.id)).toBe(true);
  expect(around.messages.length).toBeLessThanOrEqual(50);
});
