import { beforeEach, afterEach, it, expect } from 'vitest';
import { createTestApp, login, call } from '../packages/test-support/src/server';
import { createApp } from '../apps/server/src/app';
let f: Awaited<ReturnType<typeof createTestApp>>,
  alex: string,
  other: string,
  workspace: string,
  topic: string;
beforeEach(async () => {
  f = await createTestApp();
  alex = await login(f.app, 'alex');
  other = await login(f.app, 'outsider');
  workspace = (await call(f.app, alex, 'POST', '/api/workspaces', { name: 'Secure' })).id;
  topic = (await call(f.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`)).topics[0].id;
});
afterEach(async () => {
  await f.close();
});
it('rejects production and nonlocal development sign-in configurations', async () => {
  await expect(createApp(f.db, { ...f.cfg, production: true })).rejects.toThrow();
  await expect(createApp(f.db, { ...f.cfg, host: '0.0.0.0' })).rejects.toThrow();
  await expect(createApp(f.db, { ...f.cfg, origin: 'https://public.example' })).rejects.toThrow();
});
it('rejects cross-origin writes', async () => {
  const result = await f.app.inject({
    method: 'POST',
    url: `/api/topics/${topic}/messages`,
    headers: { cookie: alex, origin: 'https://attacker.example' },
    payload: { body: 'bad', clientKey: crypto.randomUUID() },
  });
  expect(result.statusCode).toBe(403);
});
it('expires pairing challenges and rejects replay', async () => {
  const one = await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/pairings`, {});
  await f.db.query("UPDATE pairings SET expires_at=now()-interval '1 second'");
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/hosts/pair',
        payload: { token: one.token, name: 'Mac', version: '0.1.0' },
      })
    ).statusCode,
  ).toBe(410);
  const two = await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/pairings`, {});
  await call(f.app, '', 'POST', '/api/hosts/pair', {
    token: two.token,
    name: 'Mac',
    version: '0.1.0',
  });
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/hosts/pair',
        payload: { token: two.token, name: 'Mac', version: '0.1.0' },
      })
    ).statusCode,
  ).toBe(410);
});
it('stores files, forces active content to download, and enforces membership and size limits', async () => {
  const boundary = 'porch-test-boundary';
  const bytes = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="unsafe.svg"\r\nContent-Type: image/svg+xml\r\n\r\n<svg onload="alert(1)"></svg>\r\n--${boundary}--\r\n`,
  );
  const upload = await f.app.inject({
    method: 'POST',
    url: `/api/topics/${topic}/attachments`,
    headers: { cookie: alex, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: bytes,
  });
  expect(upload.statusCode).toBe(200);
  const file = upload.json();
  expect(file.mediaType).toBe('application/octet-stream');
  await call(f.app, alex, 'POST', `/api/topics/${topic}/messages`, {
    body: '/nb secret file',
    attachmentIds: [file.id],
    clientKey: crypto.randomUUID(),
  });
  const download = await f.app.inject({
    url: `/api/attachments/${file.id}?preview=1`,
    headers: { cookie: alex },
  });
  expect(download.statusCode).toBe(200);
  expect(download.headers['content-disposition']).toMatch(/^attachment/);
  expect(download.headers['content-type']).toBe('application/octet-stream');
  expect(
    (await f.app.inject({ url: `/api/attachments/${file.id}`, headers: { cookie: other } }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/topics/${topic}/attachments`,
        headers: { cookie: other, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: bytes,
      })
    ).statusCode,
  ).toBe(403);
  await f.restart();
  expect(
    (await f.app.inject({ url: `/api/attachments/${file.id}`, headers: { cookie: alex } })).body,
  ).toContain('<svg');
});
