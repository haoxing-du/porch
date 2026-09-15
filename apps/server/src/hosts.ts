import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { id, label, hostInboundSchema } from '../../../packages/contracts/src/index';
import { tx } from './db';
import {
  user,
  member,
  topicAccess,
  uid,
  secret,
  hash,
  Problem,
  event,
  insertMessage,
} from './core';
import { Relay } from './relay';
import { Storage } from './storage';
export function hostRoutes(app: FastifyInstance, db: pg.Pool, relay: Relay, storage: Storage) {
  app.post(
    '/api/workspaces/:workspace/pairings',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const person = await user(db, req);
      const { workspace } = z.object({ workspace: id }).parse(req.params);
      await member(db, person.id, workspace);
      const token = secret();
      await db.query(
        "INSERT INTO pairings(token_hash,workspace_id,owner_id,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
        [hash(token), workspace, person.id],
      );
      return { token };
    },
  );
  app.post(
    '/api/hosts/pair',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const input = z
        .object({ token: z.string().min(30).max(100), name: label, version: z.literal('0.1.0') })
        .strict()
        .parse(req.body);
      return tx(db, async (c) => {
        const pair = (
          await c.query(
            'SELECT * FROM pairings WHERE token_hash=$1 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE',
            [hash(input.token)],
          )
        ).rows[0];
        if (!pair)
          throw new Problem(410, 'Pairing code expired or was already used. Create a new code.');
        await member(c, pair.owner_id, pair.workspace_id);
        await c.query('UPDATE pairings SET consumed_at=now() WHERE token_hash=$1', [
          hash(input.token),
        ]);
        const hostId = uid(),
          credential = secret();
        await c.query(
          'INSERT INTO hosts(id,workspace_id,owner_id,name,token_hash,version) VALUES($1,$2,$3,$4,$5,$6)',
          [hostId, pair.workspace_id, pair.owner_id, input.name, hash(credential), input.version],
        );
        await event(c, pair.workspace_id, 'host');
        return { hostId, credential, workspaceId: pair.workspace_id };
      });
    },
  );
  async function hostFromRequest(req: { headers: { authorization?: string } }) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new Problem(401, 'A host credential is required.');
    const h = (
      await db.query('SELECT * FROM hosts WHERE token_hash=$1 AND revoked_at IS NULL', [
        hash(token),
      ])
    ).rows[0];
    if (!h) throw new Problem(403, 'Host was disconnected. Pair it again.');
    await member(db, h.owner_id, h.workspace_id);
    return h;
  }
  app.get(
    '/api/hosts/connect',
    {
      websocket: true,
      preValidation: async (req) => {
        await hostFromRequest(req);
      },
    },
    (socket, req) => {
      let hostId: string | undefined;
      let chain = Promise.resolve();
      let closed = false;
      socket.on('message', (bytes) => {
        chain = chain
          .then(async () => {
            const h = await hostFromRequest(req);
            if (closed) return;
            if (!hostId) {
              hostId = h.id;
              const old = relay.connections.get(h.id);
              if (old && old !== socket) old.close(1000, 'Replaced by a new connection.');
              relay.connections.set(h.id, socket);
              const unfinished = (
                await db.query(
                  "SELECT r.id FROM runs r JOIN agent_sessions s ON s.id=r.session_id WHERE s.host_id=$1 AND r.status IN ('dispatching','accepted','working','uncertain','stopping')",
                  [h.id],
                )
              ).rows;
              socket.send(
                JSON.stringify({ type: 'reconcile', dispatchIds: unfinished.map((r) => r.id) }),
              );
            }
            const data = hostInboundSchema.parse(JSON.parse(bytes.toString()));
            if (data.type === 'heartbeat') await relay.heartbeat(h.id, data);
            else await relay.acceptEvent(h.id, data);
          })
          .catch(() => {
            socket.close(1008, 'Invalid or unauthorized host message.');
          });
      });
      socket.on('close', () => {
        closed = true;
        if (hostId && relay.connections.get(hostId) === socket)
          void relay
            .disconnect(hostId)
            .catch((error) => console.error('Host disconnect failed', { name: error.name }));
      });
      socket.on('error', () => socket.close());
    },
  );
  app.delete('/api/hosts/:host', async (req) => {
    const person = await user(db, req);
    const { host } = z.object({ host: id }).parse(req.params);
    const h = (await db.query('SELECT * FROM hosts WHERE id=$1 AND owner_id=$2', [host, person.id]))
      .rows[0];
    if (!h) throw new Problem(403, 'Only the host owner can disconnect this Mac.');
    await member(db, person.id, h.workspace_id);
    await tx(db, async (c) => {
      await c.query('UPDATE hosts SET revoked_at=now() WHERE id=$1', [host]);
      await c.query('UPDATE bots SET enabled=false WHERE host_id=$1', [host]);
      await event(c, h.workspace_id, 'host');
    });
    const ws = relay.connections.get(host);
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'revoked' }));
    await relay.disconnect(host);
    return { ok: true };
  });
  app.post('/api/workspaces/:workspace/bots', async (req) => {
    const person = await user(db, req);
    const { workspace } = z.object({ workspace: id }).parse(req.params);
    await member(db, person.id, workspace);
    const input = z
      .object({
        name: label,
        handle: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
        projectId: id,
        projectIds: z.array(id).min(1).max(100),
        shared: z.boolean(),
        trustConfirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    return tx(db, async (c) => {
      const project = (
        await c.query(
          'SELECT p.*,h.owner_id,h.workspace_id,h.revoked_at FROM projects p JOIN hosts h ON h.id=p.host_id WHERE p.id=$1',
          [input.projectId],
        )
      ).rows[0];
      if (
        !project ||
        project.owner_id !== person.id ||
        project.workspace_id !== workspace ||
        project.revoked_at
      )
        throw new Problem(403, 'Choose a project on your paired Mac.');
      const projectIds = [...new Set([...input.projectIds, input.projectId])];
      for (const p of projectIds)
        if (
          !(
            await c.query('SELECT 1 FROM projects WHERE id=$1 AND host_id=$2', [p, project.host_id])
          ).rowCount
        )
          throw new Problem(400, 'All projects must belong to this host.');
      const botId = uid();
      await c.query(
        'INSERT INTO bots(id,workspace_id,owner_id,host_id,default_project_id,name,handle,shared) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          botId,
          workspace,
          person.id,
          project.host_id,
          input.projectId,
          input.name,
          input.handle,
          input.shared,
        ],
      );
      for (const p of projectIds)
        await c.query('INSERT INTO bot_projects VALUES($1,$2)', [botId, p]);
      await event(c, workspace, 'bots');
      return { id: botId };
    });
  });
  app.patch('/api/bots/:bot', async (req) => {
    const person = await user(db, req);
    const { bot } = z.object({ bot: id }).parse(req.params);
    const input = z
      .object({
        enabled: z.boolean().optional(),
        name: label.optional(),
        projectId: id.optional(),
        projectIds: z.array(id).min(1).max(100).optional(),
      })
      .strict()
      .parse(req.body);
    const b = (await db.query('SELECT * FROM bots WHERE id=$1 AND owner_id=$2', [bot, person.id]))
      .rows[0];
    if (!b) throw new Problem(403, 'Only the bot owner can configure this bot.');
    await member(db, person.id, b.workspace_id);
    await tx(db, async (c) => {
      for (const p of [...(input.projectIds ?? []), ...(input.projectId ? [input.projectId] : [])])
        if (
          !(await c.query('SELECT 1 FROM projects WHERE id=$1 AND host_id=$2', [p, b.host_id]))
            .rowCount
        )
          throw new Problem(400, 'Choose a project registered on this bot’s host.');
      await c.query(
        'UPDATE bots SET enabled=COALESCE($2,enabled),name=COALESCE($3,name),default_project_id=COALESCE($4,default_project_id) WHERE id=$1',
        [bot, input.enabled ?? null, input.name ?? null, input.projectId ?? null],
      );
      if (input.projectIds) {
        await c.query('DELETE FROM bot_projects WHERE bot_id=$1', [bot]);
        for (const p of new Set([...input.projectIds, input.projectId ?? b.default_project_id]))
          await c.query('INSERT INTO bot_projects VALUES($1,$2)', [bot, p]);
      }
      if (input.enabled === false) {
        await c.query(
          "UPDATE requests SET state='canceled' WHERE state='pending' AND session_id IN(SELECT s.id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE b.bot_id=$1)",
          [bot],
        );
        await c.query(
          "UPDATE runs SET status='stopping' WHERE status IN ('dispatching','accepted','working') AND session_id IN(SELECT s.id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE b.bot_id=$1)",
          [bot],
        );
      }
      await event(c, b.workspace_id, 'bots');
    });
    await relay.tick();
    return { ok: true };
  });
  app.post('/api/sessions/:session/action', async (req) => {
    const person = await user(db, req);
    const { session } = z.object({ session: id }).parse(req.params);
    const input = z
      .object({
        action: z.enum(['stop', 'dismiss', 'fresh', 'retry']),
        confirmed: z.boolean().optional(),
        projectId: id.optional(),
      })
      .strict()
      .parse(req.body);
    await tx(db, async (c) => {
      const meta = (
        await c.query(
          'SELECT b.topic_id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE s.id=$1',
          [session],
        )
      ).rows[0];
      if (!meta) throw new Problem(404, 'Session not found.');
      const topic = await topicAccess(c, person.id, meta.topic_id);
      await c.query('SELECT id FROM topics WHERE id=$1 FOR UPDATE', [meta.topic_id]);
      const s = (
        await c.query(
          'SELECT s.*,b.epoch,b.bot_id,b.generation AS current_generation,bot.name AS bot_name,bot.host_id AS configured_host,bot.enabled FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id WHERE s.id=$1 FOR UPDATE OF s',
          [session],
        )
      ).rows[0];
      if (s.generation !== s.current_generation)
        throw new Problem(409, 'This session was replaced. Refresh the topic.');
      if (input.action === 'retry') {
        const h = (
          await c.query(
            "SELECT 1 FROM hosts WHERE id=$1 AND revoked_at IS NULL AND last_seen>now()-interval '45 seconds' AND setup_error IS NULL",
            [s.host_id],
          )
        ).rowCount;
        if (!h || !relay.connections.has(s.host_id) || !s.enabled)
          throw new Problem(409, 'Connect the Mac and enable the bot before retrying.');
        if (
          (
            await c.query(
              "SELECT 1 FROM runs WHERE session_id=$1 AND status IN ('dispatching','accepted','working','stopping')",
              [session],
            )
          ).rowCount
        )
          throw new Problem(409, 'Wait for current work to stop before retrying.');
        const r = (
          await c.query(
            "SELECT r.id FROM requests r JOIN messages m ON m.id=r.message_id WHERE r.session_id=$1 AND r.state IN ('offline','uncertain','failed','canceled','accepted','dispatched') ORDER BY m.seq DESC LIMIT 1",
            [session],
          )
        ).rows[0];
        if (!r) throw new Problem(409, 'There is no request to retry. Send a new message.');
        // Explicit retry fences uncertain previous work; the companion still serializes the folder.
        await c.query("UPDATE bindings SET epoch=epoch+1,participation='following' WHERE id=$1", [
          s.binding_id,
        ]);
        await c.query(
          "UPDATE runs SET status='interrupted' WHERE session_id=$1 AND status='uncertain'",
          [session],
        );
        await c.query("UPDATE requests SET state='pending',epoch=$2,due_at=now() WHERE id=$1", [
          r.id,
          s.epoch + 1,
        ]);
        await c.query(
          "UPDATE agent_sessions SET state='queued',error=NULL,cursor=LEAST(cursor,(SELECT m.seq-1 FROM requests r JOIN messages m ON m.id=r.message_id WHERE r.id=$2)) WHERE id=$1",
          [session, r.id],
        );
      } else {
        if (input.action === 'fresh' && !input.confirmed)
          throw new Problem(
            400,
            'Confirm that you want to stop current work and start a fresh session.',
          );
        await c.query('UPDATE bindings SET epoch=epoch+1,participation=$2 WHERE id=$1', [
          s.binding_id,
          input.action === 'dismiss' ? 'dismissed' : 'following',
        ]);
        await c.query(
          "UPDATE requests SET state='canceled' WHERE session_id=$1 AND state IN ('pending','dispatched','accepted')",
          [session],
        );
        const active = (
          await c.query(
            "UPDATE runs SET status='stopping' WHERE session_id=$1 AND status IN ('dispatching','accepted','working','uncertain','stopping') RETURNING id",
            [session],
          )
        ).rows;
        if (input.action === 'fresh') {
          const project = input.projectId ?? s.project_id;
          if (
            !(
              await c.query(
                'SELECT 1 FROM bot_projects bp JOIN projects p ON p.id=bp.project_id WHERE bp.bot_id=$1 AND bp.project_id=$2 AND p.host_id=$3',
                [s.bot_id, project, s.configured_host],
              )
            ).rowCount
          )
            throw new Problem(400, 'Choose a project registered by the bot owner.');
          const marker = await insertMessage(c, {
            topicId: meta.topic_id,
            authorId: person.id,
            authorName: person.name,
            authorType: 'system',
            body: `${person.name}: ${s.bot_name} started a fresh session.`,
            clientKey: uid(),
          });
          await c.query('UPDATE bindings SET generation=generation+1 WHERE id=$1', [s.binding_id]);
          await c.query(
            'INSERT INTO agent_sessions(id,binding_id,generation,host_id,project_id,cursor,start_seq) VALUES($1,$2,$3,$4,$5,$6,$6)',
            [uid(), s.binding_id, s.generation + 1, s.configured_host, project, marker.seq],
          );
          await event(c, topic.workspace_id, 'message', meta.topic_id);
        } else {
          await c.query('UPDATE agent_sessions SET state=$2,error=NULL WHERE id=$1', [
            session,
            active.length ? 'stopping' : 'following',
          ]);
          await insertMessage(c, {
            topicId: meta.topic_id,
            authorId: person.id,
            authorName: person.name,
            authorType: 'system',
            body: `${person.name} ${input.action === 'dismiss' ? 'dismissed' : 'requested a stop for'} ${s.bot_name}.${active.length ? ' Waiting for the Mac to confirm.' : ''}`,
            clientKey: uid(),
          });
          await event(c, topic.workspace_id, 'message', meta.topic_id);
        }
      }
      await event(c, topic.workspace_id, 'session', meta.topic_id);
    });
    await relay.tick();
    return { ok: true };
  });
  app.get('/api/sessions/:session/activity', async (req) => {
    const person = await user(db, req);
    const { session } = z.object({ session: id }).parse(req.params);
    const meta = (
      await db.query(
        'SELECT b.topic_id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id WHERE s.id=$1',
        [session],
      )
    ).rows[0];
    if (!meta) throw new Problem(404, 'Session not found.');
    await topicAccess(db, person.id, meta.topic_id);
    return {
      activities: (
        await db.query(
          'SELECT a.kind,a.created_at FROM activities a JOIN runs r ON r.id=a.run_id WHERE r.session_id=$1 ORDER BY a.created_at DESC LIMIT 100',
          [session],
        )
      ).rows,
    };
  });
  app.get('/api/agent-attachments/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(req.params);
    const a = (
      await db.query(
        `SELECT a.* FROM attachment_grants g JOIN attachments a ON a.id=g.attachment_id JOIN messages m ON m.id=a.message_id JOIN agent_sessions s ON s.id=g.session_id JOIN bindings b ON b.id=s.binding_id JOIN runs r ON r.id=g.run_id JOIN hosts h ON h.id=s.host_id JOIN bots bot ON bot.id=b.bot_id WHERE g.token_hash=$1 AND g.expires_at>now() AND NOT m.human_only AND m.topic_id=b.topic_id AND s.generation=b.generation AND r.epoch=b.epoch AND r.status IN ('dispatching','accepted','working') AND h.revoked_at IS NULL AND bot.enabled`,
        [hash(token)],
      )
    ).rows[0];
    if (!a) throw new Problem(403, 'This attachment grant is not valid.');
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', 'attachment')
      .header('Cache-Control', 'no-store');
    return reply.send(await storage.get(a.object_key));
  });
}
