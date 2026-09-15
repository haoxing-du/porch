import type pg from 'pg';
import type WebSocket from 'ws';
import { z } from 'zod';
import { tx } from './db';
import { uid, secret, hash, Problem, event, messages, insertMessage } from './core';
import {
  PROTOCOL_VERSION,
  projectContext,
  dispatchSchema,
  hostEventSchema,
  type Dispatch,
  type HostEvent,
  type hostInboundSchema,
} from '../../../packages/contracts/src/index';
import type { Config } from './config';
type Heartbeat = Extract<z.infer<typeof hostInboundSchema>, { type: 'heartbeat' }>;
export class Relay {
  connections = new Map<string, WebSocket>();
  private busy = false;
  private lastSent = new Map<string, number>();
  constructor(
    readonly db: pg.Pool,
    readonly cfg: Config,
  ) {}
  async initialize() {
    // A service restart cannot prove that an in-flight command did or did not execute.
    await tx(this.db, async (c) => {
      await c.query('UPDATE hosts SET last_seen=NULL');
      await c.query("UPDATE requests SET state='offline' WHERE state='pending'");
      await c.query(
        "UPDATE runs SET status='uncertain',error='Service restarted. Reconnect the companion to check this run.' WHERE status IN ('dispatching','accepted','working')",
      );
      await c.query(
        "UPDATE agent_sessions SET state='uncertain',error='Reconnect the companion to check the interrupted connection.' WHERE id IN(SELECT session_id FROM runs WHERE status='uncertain')",
      );
    });
  }
  schedule = async (c: pg.PoolClient, topicId: string, messageId: string, mentions: string[]) => {
    for (const botId of new Set(mentions)) {
      const bot = (await c.query('SELECT * FROM bots WHERE id=$1 AND enabled', [botId])).rows[0];
      if (!bot) continue;
      const binding = (
        await c.query(
          "INSERT INTO bindings(id,topic_id,bot_id) VALUES($1,$2,$3) ON CONFLICT(topic_id,bot_id) DO UPDATE SET participation='following' RETURNING *",
          [uid(), topicId, botId],
        )
      ).rows[0];
      await c.query(
        'INSERT INTO agent_sessions(id,binding_id,generation,host_id,project_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(binding_id,generation) DO NOTHING',
        [uid(), binding.id, binding.generation, bot.host_id, bot.default_project_id],
      );
    }
    const sessions = (
      await c.query(
        `SELECT s.*,b.epoch,b.bot_id,bot.enabled,bot.host_id AS configured_host,h.setup_error,p.available,(h.revoked_at IS NULL AND h.last_seen>now()-interval '45 seconds') AS online FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id AND b.generation=s.generation JOIN bots bot ON bot.id=b.bot_id JOIN hosts h ON h.id=s.host_id JOIN projects p ON p.id=s.project_id WHERE b.topic_id=$1 AND b.participation='following' AND bot.enabled`,
        [topicId],
      )
    ).rows;
    for (const s of sessions) {
      const active = (
        await c.query(
          "SELECT 1 FROM runs WHERE session_id=$1 AND status IN ('dispatching','accepted','working','stopping')",
          [s.id],
        )
      ).rowCount;
      const pending = (
        await c.query(
          "SELECT count(*)::int AS count FROM requests WHERE session_id=$1 AND state='pending'",
          [s.id],
        )
      ).rows[0].count;
      const blocked =
        ['stopping', 'uncertain', 'error'].includes(s.state) ||
        s.configured_host !== s.host_id ||
        pending >= 100;
      const available =
        s.online && this.connections.has(s.host_id) && !s.setup_error && s.available && !blocked;
      await c.query(
        "INSERT INTO requests(id,session_id,message_id,epoch,state,due_at) VALUES($1,$2,$3,$4,$5,now()+($6::int*interval '1 millisecond')) ON CONFLICT DO NOTHING",
        [
          uid(),
          s.id,
          messageId,
          s.epoch,
          available ? 'pending' : 'offline',
          mentions.includes(s.bot_id) && !active ? 0 : 750,
        ],
      );
      if (!active) {
        const error = available
          ? null
          : pending >= 100
            ? 'The queue is full. Retry this request after pending work completes.'
            : s.configured_host !== s.host_id
              ? 'This bot moved to another host. Choose Start fresh.'
              : (s.setup_error ??
                (!s.available
                  ? 'Project unavailable. Repair the folder in the companion.'
                  : blocked
                    ? (s.error ?? 'Resolve the current session before retrying.')
                    : 'Not sent to agent. Reconnect the Mac, then retry explicitly.'));
        await c.query('UPDATE agent_sessions SET state=$2,error=$3 WHERE id=$1', [
          s.id,
          available ? 'queued' : blocked ? s.state : 'offline',
          error,
        ]);
      }
    }
  };
  async heartbeat(hostId: string, input: Heartbeat) {
    await tx(this.db, async (c) => {
      const h = (
        await c.query('SELECT * FROM hosts WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [hostId])
      ).rows[0];
      if (!h) throw new Problem(403, 'Host was disconnected. Pair it again.');
      if (
        !(
          await c.query('SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
            h.workspace_id,
            h.owner_id,
          ])
        ).rowCount
      )
        throw new Problem(403, 'Host owner is no longer a workspace member.');
      await c.query('UPDATE hosts SET last_seen=now(),setup_error=$2 WHERE id=$1', [
        hostId,
        input.setupError,
      ]);
      await c.query('UPDATE projects SET available=false WHERE host_id=$1', [hostId]);
      for (const p of input.projects)
        await c.query(
          'INSERT INTO projects(id,host_id,local_id,label,available) VALUES($1,$2,$3,$4,$5) ON CONFLICT(host_id,local_id) DO UPDATE SET label=excluded.label,available=excluded.available',
          [uid(), hostId, p.localId, p.label, p.available],
        );
      await event(c, h.workspace_id, 'host');
    });
  }
  async disconnect(hostId: string) {
    this.connections.delete(hostId);
    await tx(this.db, async (c) => {
      const h = (
        await c.query('UPDATE hosts SET last_seen=NULL WHERE id=$1 RETURNING workspace_id', [
          hostId,
        ])
      ).rows[0];
      if (!h) return;
      await c.query(
        "UPDATE requests SET state='offline' WHERE state='pending' AND session_id IN(SELECT id FROM agent_sessions WHERE host_id=$1)",
        [hostId],
      );
      await c.query(
        "UPDATE runs SET status='uncertain',error='The host disconnected. Check the run before retrying.' WHERE status IN ('accepted','working','dispatching') AND session_id IN(SELECT id FROM agent_sessions WHERE host_id=$1)",
        [hostId],
      );
      await c.query(
        "UPDATE agent_sessions SET state=CASE WHEN state='stopping' THEN state ELSE 'uncertain' END,error='The host disconnected. Reconnect to check this run.' WHERE host_id=$1 AND id IN(SELECT session_id FROM runs WHERE status='uncertain')",
        [hostId],
      );
      await event(c, h.workspace_id, 'host');
    });
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const expired = (
        await this.db.query(
          "SELECT id FROM hosts WHERE last_seen<now()-interval '45 seconds' AND revoked_at IS NULL",
        )
      ).rows;
      for (const h of expired) {
        this.connections.get(h.id)?.close(1001, 'Heartbeat expired');
        await this.disconnect(h.id);
      }
      const disabled = (
        await this.db.query(
          `SELECT r.id,r.epoch,s.host_id FROM runs r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id JOIN hosts h ON h.id=s.host_id WHERE r.status IN ('dispatching','accepted','working','stopping') AND (NOT bot.enabled OR h.revoked_at IS NOT NULL OR r.status='stopping')`,
        )
      ).rows;
      for (const r of disabled) {
        await this.db.query("UPDATE runs SET status='stopping' WHERE id=$1", [r.id]);
        this.send(r.host_id, { type: 'cancel', dispatchId: r.id, epoch: r.epoch });
      }
      const ready = (
        await this.db.query(
          `SELECT DISTINCT r.session_id FROM requests r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id JOIN hosts h ON h.id=s.host_id JOIN bots bot ON bot.id=b.bot_id WHERE r.state='pending' AND r.due_at<=now() AND r.epoch=b.epoch AND b.generation=s.generation AND b.participation='following' AND bot.enabled AND h.revoked_at IS NULL AND h.last_seen>now()-interval '45 seconds' AND h.setup_error IS NULL AND s.state NOT IN ('stopping','uncertain','error') LIMIT 100`,
        )
      ).rows;
      for (const row of ready) await this.createDispatch(row.session_id);
      const runs = (
        await this.db.query(
          `SELECT r.*,s.host_id FROM runs r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id WHERE r.status='dispatching' AND r.epoch=b.epoch AND s.generation=b.generation ORDER BY r.created_at LIMIT 100`,
        )
      ).rows;
      for (const run of runs) {
        if (Date.now() - (this.lastSent.get(run.id) ?? 0) < 5000) continue;
        if (this.send(run.host_id, await this.payload(run.id)))
          this.lastSent.set(run.id, Date.now());
      }
    } finally {
      this.busy = false;
    }
  }
  private send(hostId: string, payload: unknown) {
    const ws = this.connections.get(hostId);
    if (!ws || ws.readyState !== 1) return false;
    if (ws.bufferedAmount > 1048576) {
      ws.close(1013, 'Host connection is overloaded.');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }
  private async createDispatch(sessionId: string) {
    await tx(this.db, async (c) => {
      const metadata = (
        await c.query(
          'SELECT b.topic_id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE s.id=$1',
          [sessionId],
        )
      ).rows[0];
      if (!metadata) return;
      await c.query('SELECT id FROM topics WHERE id=$1 FOR UPDATE', [metadata.topic_id]);
      const s = (
        await c.query(
          'SELECT s.*,b.epoch,b.generation AS current_generation,b.participation FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE s.id=$1 FOR UPDATE OF s',
          [sessionId],
        )
      ).rows[0];
      if (
        !s ||
        s.generation !== s.current_generation ||
        s.participation !== 'following' ||
        ['stopping', 'uncertain', 'error'].includes(s.state)
      )
        return;
      if (
        (
          await c.query(
            "SELECT 1 FROM runs WHERE session_id=$1 AND status IN ('dispatching','accepted','working','stopping')",
            [sessionId],
          )
        ).rowCount
      )
        return;
      let requests = (
        await c.query(
          "SELECT r.id,m.seq,m.body FROM requests r JOIN messages m ON m.id=r.message_id WHERE r.session_id=$1 AND r.state='pending' AND r.epoch=$2 AND r.due_at<=now() ORDER BY m.seq LIMIT 3",
          [sessionId, s.epoch],
        )
      ).rows;
      let characters = 0,
        count = 0;
      for (const r of requests) {
        if (characters + r.body.length > 24000) break;
        characters += r.body.length;
        count++;
      }
      requests = requests.slice(0, count);
      if (!requests.length) return;
      const through = requests.at(-1)!.seq;
      const cursor = Math.max(s.cursor, s.start_seq);
      const history = await messages(c, metadata.topic_id, {
        eligible: true,
        after: cursor,
        before: through + 1,
        limit: 51,
      });
      for (const r of requests)
        if (!history.some((m) => m.seq === r.seq))
          history.push(
            ...(await messages(c, metadata.topic_id, {
              eligible: true,
              after: r.seq - 1,
              before: r.seq + 1,
              limit: 1,
            })),
          );
      const context = projectContext(history, {
        cursor,
        triggerSeqs: requests.map((r) => r.seq),
        maxMessages: 50,
        maxChars: 24000,
      });
      const runId = uid();
      await c.query(
        "INSERT INTO runs(id,session_id,epoch,status,context) VALUES($1,$2,$3,'dispatching',$4)",
        [runId, sessionId, s.epoch, context],
      );
      for (const r of requests) {
        await c.query("UPDATE requests SET state='dispatched' WHERE id=$1", [r.id]);
        await c.query('INSERT INTO run_requests VALUES($1,$2)', [runId, r.id]);
      }
      await c.query("UPDATE agent_sessions SET state='queued',error=NULL WHERE id=$1", [sessionId]);
    });
  }
  async payload(runId: string): Promise<Dispatch> {
    const r = (
      await this.db.query(
        `SELECT r.*,s.generation,s.thread_id AS session_thread,s.project_id,p.local_id,b.bot_id,bot.name AS bot_name,t.title,c.name AS channel_name,w.name AS workspace_name FROM runs r JOIN agent_sessions s ON s.id=r.session_id JOIN projects p ON p.id=s.project_id JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id JOIN topics t ON t.id=b.topic_id JOIN channels c ON c.id=t.channel_id JOIN workspaces w ON w.id=c.workspace_id WHERE r.id=$1`,
        [runId],
      )
    ).rows[0];
    const context = structuredClone(r.context);
    for (const message of context.messages) {
      for (const a of message.attachments) {
        if (message.purpose !== 'request') continue;
        const token = secret();
        await this.db.query(
          "INSERT INTO attachment_grants(token_hash,attachment_id,session_id,run_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
          [hash(token), a.id, r.session_id, r.id],
        );
        a.url = `${this.cfg.origin}/api/agent-attachments/${token}`;
      }
    }
    return dispatchSchema.parse({
      type: 'dispatch',
      version: PROTOCOL_VERSION,
      dispatchId: r.id,
      sessionId: r.session_id,
      botId: r.bot_id,
      epoch: r.epoch,
      generation: r.generation,
      projectId: r.project_id,
      localProjectId: r.local_id,
      threadId: r.session_thread,
      botName: r.bot_name,
      topicTitle: r.title,
      channelName: r.channel_name,
      workspaceName: r.workspace_name,
      context,
    });
  }
  async acceptEvent(hostId: string, input: HostEvent) {
    const incoming = hostEventSchema.parse(input);
    await tx(this.db, async (c) => {
      const meta = (
        await c.query(
          `SELECT b.topic_id FROM runs r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id WHERE r.id=$1 AND s.host_id=$2`,
          [incoming.dispatchId, hostId],
        )
      ).rows[0];
      if (!meta) throw new Problem(403, 'This run does not belong to this host.');
      await c.query('SELECT id FROM topics WHERE id=$1 FOR UPDATE', [meta.topic_id]);
      const r = (
        await c.query(
          `SELECT r.*,s.generation,s.binding_id,b.epoch AS current_epoch,b.generation AS current_generation,b.topic_id,b.bot_id,bot.name AS bot_name,bot.enabled,bot.workspace_id,h.revoked_at FROM runs r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id JOIN hosts h ON h.id=s.host_id WHERE r.id=$1 FOR UPDATE OF r`,
          [incoming.dispatchId],
        )
      ).rows[0];
      if (
        !(
          await c.query(
            'INSERT INTO host_events VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',
            [hostId, incoming.eventId],
          )
        ).rowCount
      )
        return;
      const stale =
        r.epoch !== r.current_epoch ||
        r.generation !== r.current_generation ||
        incoming.epoch !== r.epoch ||
        !r.enabled ||
        r.revoked_at;
      if (stale) {
        if (['completed', 'failed', 'interrupted', 'uncertain'].includes(incoming.kind)) {
          await c.query(
            "UPDATE runs SET status='interrupted',updated_at=now() WHERE id=$1 AND status NOT IN ('completed','failed','interrupted')",
            [r.id],
          );
          if (r.generation === r.current_generation)
            await c.query(
              "UPDATE agent_sessions SET state='following',error=NULL WHERE id=$1 AND state='stopping'",
              [r.session_id],
            );
          await event(c, r.workspace_id, 'session', r.topic_id);
        }
        return;
      }
      if (['completed', 'failed', 'interrupted'].includes(r.status)) return;
      if (incoming.kind === 'accepted') {
        if (!incoming.threadId) throw new Problem(400, 'A thread ID is required for acceptance.');
        const current = (
          await c.query('SELECT thread_id FROM agent_sessions WHERE id=$1', [r.session_id])
        ).rows[0];
        if (current.thread_id && current.thread_id !== incoming.threadId)
          throw new Problem(409, 'The thread changed. Start fresh explicitly.');
        await c.query(
          "UPDATE runs SET status='accepted',thread_id=$2,updated_at=now() WHERE id=$1",
          [r.id, incoming.threadId],
        );
        await c.query(
          "UPDATE agent_sessions SET thread_id=$2,cursor=GREATEST(cursor,$3),state='starting',error=NULL WHERE id=$1",
          [r.session_id, incoming.threadId, r.context.throughSeq],
        );
        await c.query(
          "UPDATE requests SET state='accepted' WHERE id IN(SELECT request_id FROM run_requests WHERE run_id=$1)",
          [r.id],
        );
      } else if (incoming.kind === 'working') {
        if (!incoming.turnId) throw new Problem(400, 'A turn ID is required.');
        await c.query("UPDATE runs SET status='working',turn_id=$2,updated_at=now() WHERE id=$1", [
          r.id,
          incoming.turnId,
        ]);
        await c.query("UPDATE agent_sessions SET state='working' WHERE id=$1", [r.session_id]);
      } else if (incoming.kind === 'completed') {
        if (!incoming.outcome || !incoming.itemId)
          throw new Problem(400, 'A structured final output is required.');
        if (
          incoming.outcome.kind !== 'silent' &&
          (
            await c.query(
              'INSERT INTO output_items VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING item_id',
              [r.id, incoming.itemId],
            )
          ).rowCount
        ) {
          await insertMessage(c, {
            topicId: r.topic_id,
            authorId: r.bot_id,
            authorName: r.bot_name,
            authorType: 'bot',
            body: incoming.outcome.text,
            clientKey: r.id,
          });
          await event(c, r.workspace_id, 'message', r.topic_id);
        }
        await c.query(
          "UPDATE runs SET status='completed',turn_id=COALESCE($2,turn_id),updated_at=now() WHERE id=$1",
          [r.id, incoming.turnId ?? null],
        );
        await c.query('UPDATE agent_sessions SET state=$2,error=NULL WHERE id=$1', [
          r.session_id,
          incoming.outcome.kind === 'wait' ? 'waiting' : 'following',
        ]);
        await c.query(
          "UPDATE requests SET state='completed' WHERE id IN(SELECT request_id FROM run_requests WHERE run_id=$1)",
          [r.id],
        );
      } else if (incoming.kind === 'activity') {
        // Store categories only. No raw tool text, private reasoning, or command output.
        if (incoming.activity)
          await c.query('INSERT INTO activities(id,run_id,kind) VALUES($1,$2,$3)', [
            incoming.eventId,
            r.id,
            incoming.activity,
          ]);
      } else {
        const state =
          incoming.kind === 'uncertain'
            ? 'uncertain'
            : incoming.kind === 'interrupted'
              ? 'interrupted'
              : 'failed';
        await c.query('UPDATE runs SET status=$2,error=$3,updated_at=now() WHERE id=$1', [
          r.id,
          state,
          incoming.error ?? 'Work stopped. Retry explicitly.',
        ]);
        await c.query('UPDATE agent_sessions SET state=$2,error=$3 WHERE id=$1', [
          r.session_id,
          state === 'uncertain' ? 'uncertain' : 'error',
          incoming.error ?? 'Work stopped. Retry explicitly.',
        ]);
        await c.query(
          'UPDATE requests SET state=$2 WHERE id IN(SELECT request_id FROM run_requests WHERE run_id=$1)',
          [r.id, state === 'interrupted' ? 'canceled' : state],
        );
        await c.query(
          "UPDATE requests SET state='offline' WHERE session_id=$1 AND state='pending'",
          [r.session_id],
        );
      }
      await event(c, r.workspace_id, 'session', r.topic_id);
    });
    this.send(hostId, { type: 'eventAck', eventId: incoming.eventId });
  }
}
