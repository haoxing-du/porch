import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { createTestApp, login, call } from '../packages/test-support/src/server';
import { CodexAdapter } from '../packages/codex-adapter/src/index';
import { HostRuntime, Journal } from '../apps/companion/src/runtime';
const fixture = await createTestApp();
const project = await mkdtemp(join(tmpdir(), 'porch-real-project-'));
const data = await mkdtemp(join(tmpdir(), 'porch-real-host-'));
const adapter = new CodexAdapter(
  process.env.CODEX_EXECUTABLE ?? '/Applications/ChatGPT.app/Contents/Resources/codex',
);
let runtime: HostRuntime | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
const started = new Date().toISOString();
try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
  await adapter.start();
  const account = await adapter.account();
  if (account.requiresOpenaiAuth && !account.account) throw new Error('Codex sign-in required.');
  const origin = await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  fixture.cfg.origin = origin;
  const alex = await login(fixture.app, 'alex'),
    sam = await login(fixture.app, 'sam');
  const workspace = (
    await call(fixture.app, alex, 'POST', '/api/workspaces', { name: 'Real Codex check' })
  ).id;
  const invite = await call(fixture.app, alex, 'POST', `/api/workspaces/${workspace}/invites`, {});
  await call(fixture.app, sam, 'POST', '/api/invites/join', { token: invite.token });
  const topic = (await call(fixture.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`))
    .topics[0].id;
  const pairing = await call(
    fixture.app,
    alex,
    'POST',
    `/api/workspaces/${workspace}/pairings`,
    {},
  );
  const paired = await call(fixture.app, '', 'POST', '/api/hosts/pair', {
    token: pairing.token,
    name: 'Real test Mac',
    version: '0.1.0',
  });
  runtime = new HostRuntime({
    origin,
    credential: paired.credential,
    hostId: paired.hostId,
    projects: () => [
      {
        localId: 'bf7d6e85-13c6-47c0-b6c5-7796520c9b11',
        label: 'Disposable test repository',
        path: project,
      },
    ],
    adapter,
    journal: await Journal.open(join(data, 'journal.json')),
    dataDir: data,
  });
  runtime.on('status', (value) => console.log('Host:', value));
  runtime.start();
  tick = setInterval(() => {
    fixture.app.relay.tick().catch((e) => console.error('Dispatch failed', e.message));
  }, 200);
  let registered;
  for (let i = 0; i < 100; i++) {
    registered = (await call(fixture.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`))
      .projects[0];
    if (registered) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!registered) throw new Error('Host did not register its project.');
  const bot = (
    await call(fixture.app, alex, 'POST', `/api/workspaces/${workspace}/bots`, {
      name: 'SHODAN',
      handle: 'shodan',
      projectId: registered.id,
      projectIds: [registered.id],
      shared: true,
      trustConfirmed: true,
    })
  ).id;
  browser = await chromium.launch();
  const alexContext = await browser.newContext();
  const samContext = await browser.newContext();
  for (const [context, cookie] of [
    [alexContext, alex],
    [samContext, sam],
  ] as const)
    await context.addCookies([{ name: 'porch', value: cookie.split('=')[1], url: origin }]);
  const alexPage = await alexContext.newPage(),
    samPage = await samContext.newPage();
  await alexPage.goto(`${origin}/w/${workspace}/t/${topic}`);
  await samPage.goto(`${origin}/w/${workspace}/t/${topic}`);
  await alexPage.getByRole('textbox', { name: 'Message' }).fill('/nb HUMAN_ONLY_REAL_CANARY_93f21');
  await alexPage.getByRole('button', { name: 'Send message' }).click();
  await alexPage.getByRole('textbox', { name: 'Message' }).fill('@shodan');
  await alexPage.getByRole('button', { name: '✳ SHODAN Available' }).click();
  await alexPage
    .getByRole('textbox', { name: 'Message' })
    .fill(
      '@shodan Create greeting.txt in this repository with exactly "hello porch\\n" (one line). Do not modify any other file. Return a reply when done.',
    );
  await alexPage.getByRole('button', { name: 'Send message' }).click();
  async function completed(count: number) {
    for (let i = 0; i < 1800; i++) {
      const runs = (await fixture.db.query('SELECT status,error FROM runs ORDER BY created_at'))
        .rows;
      if (runs.some((r) => ['failed', 'uncertain'].includes(r.status)))
        throw new Error(JSON.stringify(runs));
      if (runs.filter((r) => r.status === 'completed').length >= count) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Real Codex check timed out.');
  }
  console.log('Waiting for the real file creation.');
  await completed(1);
  expect(await readFile(join(project, 'greeting.txt'), 'utf8')).toBe('hello porch\n');
  const first = (await fixture.db.query('SELECT thread_id FROM agent_sessions')).rows[0].thread_id;
  console.log('First edit verified.');
  await alexPage.close();
  await samPage
    .getByRole('textbox', { name: 'Message' })
    .fill(
      'Append "from sam" as a second line in greeting.txt. Keep its first line. Return a reply when done.',
    );
  await samPage.getByRole('button', { name: 'Send message' }).click();
  await completed(2);
  expect(await readFile(join(project, 'greeting.txt'), 'utf8')).toBe('hello porch\nfrom sam\n');
  expect((await fixture.db.query('SELECT thread_id FROM agent_sessions')).rows[0].thread_id).toBe(
    first,
  );
  console.log('Second member edit verified in the same thread.');
  await samPage
    .getByRole('textbox', { name: 'Message' })
    .fill(
      'For this output protocol check, choose the silent outcome with empty text. Do not edit any files.',
    );
  await samPage.getByRole('button', { name: 'Send message' }).click();
  await completed(3);
  expect(
    (await fixture.db.query("SELECT * FROM messages WHERE author_type='bot'")).rows,
  ).toHaveLength(2);
  console.log('Silent outcome verified.');
  await samPage
    .getByRole('textbox', { name: 'Message' })
    .fill('Ask me which color to use, using the wait outcome. Do not edit any files.');
  await samPage.getByRole('button', { name: 'Send message' }).click();
  await completed(4);
  expect((await fixture.db.query('SELECT state FROM agent_sessions')).rows[0].state).toBe(
    'waiting',
  );
  const serialized = JSON.stringify((await fixture.db.query('SELECT context FROM runs')).rows);
  expect(serialized).not.toContain('HUMAN_ONLY_REAL_CANARY');
  expect(await readFile(join(data, 'journal.json'), 'utf8')).not.toContain(
    'HUMAN_ONLY_REAL_CANARY',
  );
  await samPage.screenshot({ path: 'test-results/real-codex-chat.png', fullPage: true });
  const evidence = {
    started,
    completed: new Date().toISOString(),
    runtime: 'codex-cli 0.153.1',
    platform: process.platform,
    checks: [
      'Two browser users in one invited workspace',
      'Real greeting.txt creation from a structured web mention',
      'Second member follow-up edits same file in same Codex thread',
      'First browser closes without ending host/session',
      'Structured reply, silent, and wait outcomes',
      'Human-only canary absent from run payloads and host journal',
    ],
    threadId: first,
    fileContents: await readFile(join(project, 'greeting.txt'), 'utf8'),
  };
  await writeFile('docs/real-codex-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  clearInterval(tick);
  await runtime?.stop();
  adapter.close();
  await browser?.close();
  await fixture.close();
  await rm(project, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
}
