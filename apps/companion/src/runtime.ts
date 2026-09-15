import { readFile, open, rename, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  CodexAdapter,
  decodeOutcome,
  repairMessage,
} from '../../../packages/codex-adapter/src/index';
import {
  PROTOCOL_VERSION,
  dispatchSchema,
  hostEventSchema,
  hostCommandSchema,
  type Dispatch,
  type HostEvent,
} from '../../../packages/contracts/src/index';
const recordSchema = z.object({
  dispatch: dispatchSchema,
  phase: z.enum([
    'queued',
    'accepted',
    'starting',
    'working',
    'completed',
    'interrupted',
    'failed',
    'uncertain',
  ]),
  threadId: z.string().optional(),
  turnId: z.string().optional(),
  priorTurnIds: z.array(z.string()).default([]),
});
const journalSchema = z.object({
  version: z.literal(1),
  records: z.record(recordSchema),
  events: z.array(hostEventSchema),
  canceled: z.array(z.string()),
});
export type JournalState = z.infer<typeof journalSchema>;
export class Journal {
  private tail: Promise<void> = Promise.resolve();
  private constructor(
    readonly path: string,
    public state: JournalState,
  ) {}
  static async open(path: string) {
    let state: JournalState;
    try {
      state = journalSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('The companion journal is damaged. Restore it before running work.');
      state = { version: 1, records: {}, events: [], canceled: [] };
    }
    return new Journal(path, state);
  }
  async update(change: (state: JournalState) => void) {
    const next = this.tail.then(async () => {
      const state = structuredClone(this.state);
      change(state);
      journalSchema.parse(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.path);
      const directory = await open(dirname(this.path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.state = state;
    });
    this.tail = next;
    return next;
  }
}
export class FolderQueue {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error('The registered project is not a folder.');
    const key = `${info.dev}:${info.ino}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(fn);
    this.tails.set(key, result);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === result) this.tails.delete(key);
    }
  }
}
export type LocalProject = { localId: string; label: string; path: string };
export class HostRuntime extends EventEmitter {
  private ws?: WebSocket;
  private timer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private delay = 500;
  private connected = false;
  private queue = new FolderQueue();
  private active = new Set<string>();
  private received = new Set<string>();
  private canceled = new Set<string>();
  private messageChain = Promise.resolve();
  constructor(
    readonly options: {
      origin: string;
      credential: string;
      hostId: string;
      projects: () => LocalProject[];
      adapter: CodexAdapter;
      journal: Journal;
      dataDir: string;
    },
  ) {
    super();
    for (const id of options.journal.state.canceled) this.canceled.add(id);
  }
  start() {
    this.connect();
    this.timer = setInterval(() => {
      void this.heartbeat().catch((error) => this.emit('status', repairMessage(error)));
      this.flush();
    }, 15000);
  }
  private connect() {
    if (this.stopped) return;
    const url = new URL('/api/hosts/connect', this.options.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.options.credential}` },
      maxPayload: 256 * 1024,
    });
    this.ws.on('open', () => {
      this.connected = true;
      this.delay = 500;
      this.emit('status', 'Connected');
      void this.heartbeat().catch((error) => this.fatal(error));
      this.flush();
    });
    this.ws.on('message', (bytes) => {
      this.messageChain = this.messageChain
        .then(async () => {
          const command = hostCommandSchema.parse(JSON.parse(bytes.toString()));
          if (command.type === 'eventAck') {
            await this.options.journal.update((s) => {
              s.events = s.events.filter((e) => e.eventId !== command.eventId);
            });
          } else if (command.type === 'dispatch') {
            void this.receive(command).catch((error) => this.fatal(error));
          } else if (command.type === 'cancel') {
            await this.cancel(command.dispatchId, command.epoch);
          } else if (command.type === 'reconcile') {
            await this.reconcile(command.dispatchIds);
          } else if (command.type === 'revoked') {
            await this.stop();
            this.emit('revoked');
          }
        })
        .catch((error) => this.fatal(error));
    });
    this.ws.on('close', () => {
      this.connected = false;
      this.emit('status', this.stopped ? 'Disconnected' : 'Offline · reconnecting');
      void this.interruptAll().catch((error) => this.fatal(error));
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.delay + Math.random() * 500);
        this.delay = Math.min(30000, this.delay * 2);
      }
    });
    this.ws.on('error', () => this.ws?.close());
  }
  private fatal(error: unknown) {
    this.emit('status', error instanceof Error ? error.message : 'Companion storage failed.');
    void this.stop();
  }
  private send(value: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 1048576) {
        this.ws.close(1013, 'Transport overloaded');
        return;
      }
      this.ws.send(JSON.stringify(value));
    }
  }
  private flush() {
    for (const event of this.options.journal.state.events) this.send(event);
  }
  async heartbeat() {
    let setupError: string | null = null;
    try {
      const account = await this.options.adapter.account();
      if (account.requiresOpenaiAuth && !account.account)
        setupError = 'Sign in to Codex in the companion.';
    } catch (error) {
      setupError = repairMessage(error);
    }
    const projects = await Promise.all(
      this.options.projects().map(async (p) => {
        let available = false;
        try {
          available = (await stat(p.path)).isDirectory();
        } catch {
          /* Missing registered folders are reported explicitly to the service. */
        }
        return { localId: p.localId, label: p.label, available };
      }),
    );
    this.send({ type: 'heartbeat', version: PROTOCOL_VERSION, setupError, projects });
  }
  private async publish(
    dispatch: Dispatch,
    kind: HostEvent['kind'],
    extra: Partial<HostEvent> = {},
  ) {
    const output = hostEventSchema.parse({
      type: 'event',
      eventId: randomUUID(),
      dispatchId: dispatch.dispatchId,
      epoch: dispatch.epoch,
      kind,
      ...extra,
    });
    await this.options.journal.update((s) => {
      s.events.push(output);
      if (s.events.length > 5000)
        throw new Error('The host event queue is full. Reconnect before running more work.');
    });
    this.send(output);
  }
  async receive(dispatch: Dispatch) {
    if (this.received.has(dispatch.dispatchId)) {
      this.flush();
      return;
    }
    this.received.add(dispatch.dispatchId);
    const previous = this.options.journal.state.records[dispatch.dispatchId];
    if (previous) {
      await this.reconcile([dispatch.dispatchId]);
      return;
    }
    await this.options.journal.update((s) => {
      s.records[dispatch.dispatchId] = { dispatch, phase: 'queued', priorTurnIds: [] };
    });
    const project = this.options.projects().find((p) => p.localId === dispatch.localProjectId);
    if (!project) {
      await this.publish(dispatch, 'failed', {
        error: 'Project unavailable. Register this folder in the companion.',
      });
      return;
    }
    try {
      await this.queue.run(project.path, async () => {
        if (!this.connected || this.stopped || this.canceled.has(dispatch.dispatchId)) {
          await this.publish(dispatch, 'interrupted', {
            error: 'Work did not start. Send an explicit retry when connected.',
          });
          return;
        }
        this.active.add(dispatch.dispatchId);
        const adapter = this.options.adapter;
        try {
          const cwd = await realpath(project.path);
          const threadId = await adapter.openThread(cwd, dispatch.threadId);
          await this.options.journal.update((s) => {
            Object.assign(s.records[dispatch.dispatchId], { threadId, phase: 'accepted' });
          });
          await this.publish(dispatch, 'accepted', { threadId });
          // Read the recorded thread before starting. A fresh thread has no persisted turns yet.
          const priorTurnIds = dispatch.threadId
            ? (await adapter.readThread(threadId)).turns.map((t) => t.id)
            : [];
          const context = {
            bot: dispatch.botName,
            workspace: dispatch.workspaceName,
            channel: dispatch.channelName,
            topic: dispatch.topicTitle,
            ...structuredClone(dispatch.context),
          };
          const images: string[] = [];
          for (const message of context.messages) {
            for (const attachment of message.attachments) {
              if (message.purpose !== 'request' || !attachment.url) continue;
              const url = new URL(attachment.url);
              if (
                url.origin !== new URL(this.options.origin).origin ||
                !url.pathname.startsWith('/api/agent-attachments/')
              )
                throw new Error('Attachment grant came from another service.');
              const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error('Attachment grant expired. Retry the request.');
              if (!response.body || attachment.size > 104857600)
                throw new Error('Attachment exceeds the host limit.');
              const reader = response.body.getReader(),
                chunks: Uint8Array[] = [];
              let size = 0;
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > attachment.size || size > 104857600) {
                  await reader.cancel();
                  throw new Error('Attachment exceeded its declared size.');
                }
                chunks.push(value);
              }
              const data = Buffer.concat(chunks);
              if (data.length !== attachment.size)
                throw new Error('Attachment size changed. Upload it again.');
              const directory = join(this.options.dataDir, 'staging', dispatch.sessionId);
              await mkdir(directory, { recursive: true });
              const path = join(directory, randomUUID());
              await writeFile(path, data, { flag: 'wx', mode: 0o600 });
              attachment.url = path;
              if (attachment.mediaType.startsWith('image/')) images.push(path);
            }
          }
          if (!this.connected || this.canceled.has(dispatch.dispatchId)) {
            await this.publish(dispatch, 'interrupted', {
              threadId,
              error: 'Work stopped before the turn started.',
            });
            return;
          }
          await this.options.journal.update((s) => {
            Object.assign(s.records[dispatch.dispatchId], { phase: 'starting', priorTurnIds });
          });
          const onActivity = (thread: string, activity: HostEvent['activity']) => {
            if (thread === threadId)
              void this.publish(dispatch, 'activity', { activity }).catch((error) =>
                this.fatal(error),
              );
          };
          adapter.on('activity', onActivity);
          try {
            const result = await adapter.run(
              threadId,
              cwd,
              context,
              dispatch.dispatchId,
              async (turnId) => {
                await this.options.journal.update((s) => {
                  Object.assign(s.records[dispatch.dispatchId], { phase: 'working', turnId });
                });
                await this.publish(dispatch, 'working', { threadId, turnId });
                if (!this.connected || this.canceled.has(dispatch.dispatchId))
                  await adapter.interrupt(threadId, turnId);
              },
              images,
            );
            await this.options.journal.update((s) => {
              Object.assign(s.records[dispatch.dispatchId], {
                phase: result.status === 'interrupted' ? 'interrupted' : 'completed',
                turnId: result.turnId,
              });
            });
            if (result.status === 'interrupted')
              await this.publish(dispatch, 'interrupted', {
                threadId,
                turnId: result.turnId,
                error: 'Work was interrupted. Retry explicitly.',
              });
            else
              await this.publish(dispatch, 'completed', {
                threadId,
                turnId: result.turnId,
                outcome: result.outcome,
                itemId: `${result.turnId}:final`,
              });
          } finally {
            adapter.off('activity', onActivity);
          }
        } catch (error) {
          await this.options.journal.update((s) => {
            s.records[dispatch.dispatchId].phase = 'uncertain';
          });
          await this.publish(dispatch, 'uncertain', { error: repairMessage(error) });
        } finally {
          this.active.delete(dispatch.dispatchId);
        }
      });
    } catch (error) {
      await this.publish(dispatch, 'failed', {
        error: 'Project unavailable. Repair the registered folder in the companion.',
      });
    }
  }
  async cancel(dispatchId: string, epoch?: number) {
    this.canceled.add(dispatchId);
    await this.options.journal.update((s) => {
      if (!s.canceled.includes(dispatchId)) s.canceled.push(dispatchId);
    });
    const record = this.options.journal.state.records[dispatchId];
    if (!record) {
      if (epoch === undefined) throw new Error('A cancellation epoch is required.');
      const ack = hostEventSchema.parse({
        type: 'event',
        eventId: randomUUID(),
        dispatchId,
        epoch,
        kind: 'interrupted',
        error: 'Stop confirmed. No work started.',
      });
      await this.options.journal.update((s) => {
        s.events.push(ack);
      });
      this.send(ack);
      return;
    }
    if (record.threadId && this.active.has(dispatchId))
      await this.options.adapter.interrupt(record.threadId, record.turnId);
    else
      await this.publish(record.dispatch, 'interrupted', {
        error: 'Stop confirmed. No work is running.',
      });
  }
  private async interruptAll() {
    for (const id of this.active) {
      const record = this.options.journal.state.records[id];
      if (record?.threadId) await this.options.adapter.interrupt(record.threadId, record.turnId);
    }
  }
  async reconcile(ids: string[]) {
    for (const id of ids) {
      const record = this.options.journal.state.records[id];
      if (!record) {
        continue;
      }
      if (this.active.has(id)) {
        if (record.threadId) await this.options.adapter.interrupt(record.threadId, record.turnId);
        continue;
      }
      if (!record.threadId) {
        await this.publish(record.dispatch, 'uncertain', {
          error: 'Acceptance was not recorded. Retry explicitly.',
        });
        continue;
      }
      try {
        const thread = await this.options.adapter.readThread(record.threadId);
        const candidates = record.turnId
          ? thread.turns.filter((t) => t.id === record.turnId)
          : thread.turns.filter((t) => !record.priorTurnIds.includes(t.id));
        if (candidates.length !== 1) {
          await this.publish(record.dispatch, 'uncertain', {
            error: 'The run could not be confirmed. Review project files, then retry explicitly.',
          });
          continue;
        }
        const turn = candidates[0];
        if (turn.status === 'inProgress') {
          await this.options.adapter.openThread(
            this.options.projects().find((p) => p.localId === record.dispatch.localProjectId)!.path,
            record.threadId,
          );
          await this.options.adapter.interrupt(record.threadId, turn.id);
          await this.publish(record.dispatch, 'uncertain', {
            error: 'Interruption requested after reconnect. Check the project before retrying.',
          });
        } else if (turn.status === 'completed') {
          await this.publish(record.dispatch, 'accepted', { threadId: record.threadId });
          await this.publish(record.dispatch, 'completed', {
            threadId: record.threadId,
            turnId: turn.id,
            outcome: decodeOutcome(turn),
            itemId: `${turn.id}:final`,
          });
        } else
          await this.publish(
            record.dispatch,
            turn.status === 'interrupted' ? 'interrupted' : 'failed',
            { error: 'The previous run stopped. Retry explicitly.' },
          );
      } catch (error) {
        await this.publish(record.dispatch, 'uncertain', { error: repairMessage(error) });
      }
    }
    this.flush();
  }
  async stop() {
    this.stopped = true;
    this.connected = false;
    clearInterval(this.timer);
    clearTimeout(this.reconnectTimer);
    await this.interruptAll();
    this.ws?.close();
  }
}
