import { it, expect } from 'vitest';
import { mkdtemp, mkdir, symlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal, FolderQueue } from '../apps/companion/src/runtime';
it('serializes aliases of the same folder while allowing another folder to run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'porch-lock-'));
  try {
    await mkdir(join(root, 'a'));
    await mkdir(join(root, 'b'));
    await symlink(join(root, 'a'), join(root, 'alias'));
    const queue = new FolderQueue();
    const order: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const first = queue.run(join(root, 'a'), async () => {
      order.push('first');
      await wait;
      order.push('first done');
    });
    await new Promise((r) => setTimeout(r, 20));
    const second = queue.run(join(root, 'alias'), async () => {
      order.push('second');
    });
    const other = queue.run(join(root, 'b'), async () => {
      order.push('other');
    });
    await other;
    expect(order).toEqual(['first', 'other']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'other', 'first done', 'second']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('durably records dispatches and fails closed on a corrupt journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'porch-journal-'));
  try {
    const path = join(root, 'journal.json');
    const j = await Journal.open(path);
    await j.update((state) => {
      state.events.push({
        type: 'event',
        eventId: crypto.randomUUID(),
        dispatchId: crypto.randomUUID(),
        epoch: 1,
        kind: 'uncertain',
        error: 'Check run',
      });
    });
    const reopened = await Journal.open(path);
    expect(reopened.state.events).toHaveLength(1);
    expect(await readFile(path, 'utf8')).toContain('Check run');
    await writeFile(path, 'BROKEN');
    await expect(Journal.open(path)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('confirms a stop received before the original dispatch and fences its late delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'porch-cancel-'));
  try {
    const journal = await Journal.open(join(root, 'journal.json'));
    const { HostRuntime } = await import('../apps/companion/src/runtime');
    const host = new HostRuntime({
      origin: 'http://localhost:3001',
      credential: 'test',
      hostId: crypto.randomUUID(),
      projects: () => [],
      adapter: {} as never,
      journal,
      dataDir: root,
    });
    const dispatchId = crypto.randomUUID();
    await host.cancel(dispatchId, 7);
    expect(journal.state.canceled).toContain(dispatchId);
    expect(journal.state.events[0]).toMatchObject({ dispatchId, epoch: 7, kind: 'interrupted' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
