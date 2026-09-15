import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { id, label, sendSchema, parseMessage } from '../../../packages/contracts/src/index';
import { tx } from './db';
import { uid, secret, hash, Problem, user, member, topicAccess, event, messages, insertMessage } from './core';
import type { Config } from './config';
export type Schedule = (c:pg.PoolClient, topicId:string, messageId:string, mentions:string[])=>Promise<void>;
export function chatRoutes(app:FastifyInstance, db:pg.Pool, cfg:Config, schedule:Schedule) {
  app.post('/api/workspaces',async req=>{
    const person=await user(db,req); const {name}=z.object({name:label}).strict().parse(req.body);
    return tx(db,async c=>{const workspace=uid(); await c.query('INSERT INTO workspaces VALUES($1,$2,$3)',[workspace,name,person.id]); await c.query('INSERT INTO memberships VALUES($1,$2)',[workspace,person.id]);
      const channel=uid();await c.query('INSERT INTO channels VALUES($1,$2,$3)',[channel,workspace,'general']); await c.query('INSERT INTO topics(id,channel_id,title) VALUES($1,$2,$3)',[uid(),channel,'Welcome']);return {id:workspace,name};});
  });
  app.post('/api/workspaces/:workspace/invites',async req=>{
    const {workspace}=z.object({workspace:id}).parse(req.params);await member(db,(await user(db,req)).id,workspace,true);
    const token=secret(), invite=uid();await db.query("INSERT INTO invites(id,workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[invite,workspace,hash(token)]);return {id:invite,token,url:`${cfg.origin}/join/${token}`};
  });
  app.delete('/api/workspaces/:workspace/invites/:invite',async req=>{
    const {workspace,invite}=z.object({workspace:id,invite:id}).parse(req.params); await member(db,(await user(db,req)).id,workspace,true);
    await db.query('UPDATE invites SET revoked_at=now() WHERE id=$1 AND workspace_id=$2',[invite,workspace]);return {ok:true};
  });
  app.post('/api/invites/join',async req=>{
    const person=await user(db,req);const {token}=z.object({token:z.string().min(30).max(100)}).parse(req.body);
    return tx(db,async c=>{const invite=(await c.query('SELECT * FROM invites WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL FOR UPDATE',[hash(token)])).rows[0];if(!invite)throw new Problem(410,'This invitation expired or was revoked. Ask the owner for a new link.');
      await c.query('INSERT INTO memberships VALUES($1,$2) ON CONFLICT DO NOTHING',[invite.workspace_id,person.id]);await event(c,invite.workspace_id,'members');return {id:invite.workspace_id};});
  });
  app.delete('/api/workspaces/:workspace/members/:person',async req=>{
    const {workspace,person}=z.object({workspace:id,person:id}).parse(req.params);const actor=await user(db,req);await member(db,actor.id,workspace,true);if(person===actor.id)throw new Problem(400,'The workspace owner cannot be removed.');
    await tx(db,async c=>{await c.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2',[workspace,person]);await c.query('UPDATE bots SET enabled=false WHERE workspace_id=$1 AND owner_id=$2',[workspace,person]);
      await c.query("UPDATE requests SET state='canceled' WHERE session_id IN(SELECT s.id FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id WHERE bot.workspace_id=$1 AND bot.owner_id=$2) AND state='pending'",[workspace,person]);
      await event(c,workspace,'members');});return {ok:true};
  });
  app.post('/api/workspaces/:workspace/channels',async req=>{
    const {workspace}=z.object({workspace:id}).parse(req.params);await member(db,(await user(db,req)).id,workspace);const {name}=z.object({name:label}).strict().parse(req.body);const channel=uid();
    await tx(db,async c=>{await c.query('INSERT INTO channels VALUES($1,$2,$3)',[channel,workspace,name]);await event(c,workspace,'channels');});return {id:channel};
  });
  app.patch('/api/channels/:channel',async req=>{
    const {channel}=z.object({channel:id}).parse(req.params);const person=await user(db,req);const row=(await db.query('SELECT * FROM channels WHERE id=$1',[channel])).rows[0];if(!row)throw new Problem(404,'Channel not found.');await member(db,person.id,row.workspace_id);const {name}=z.object({name:label}).parse(req.body);
    await tx(db,async c=>{await c.query('UPDATE channels SET name=$1 WHERE id=$2',[name,channel]);await event(c,row.workspace_id,'channels');});return {ok:true};
  });
  app.post('/api/channels/:channel/topics',async req=>{
    const {channel}=z.object({channel:id}).parse(req.params);const person=await user(db,req);const row=(await db.query('SELECT * FROM channels WHERE id=$1',[channel])).rows[0];if(!row)throw new Problem(404,'Channel not found.');await member(db,person.id,row.workspace_id);const {title}=z.object({title:label}).strict().parse(req.body);const topic=uid();
    await tx(db,async c=>{await c.query('INSERT INTO topics(id,channel_id,title) VALUES($1,$2,$3)',[topic,channel,title]);await event(c,row.workspace_id,'topics');});return {id:topic};
  });
  app.patch('/api/topics/:topic',async req=>{
    const {topic}=z.object({topic:id}).parse(req.params);const row=await topicAccess(db,(await user(db,req)).id,topic);const {title}=z.object({title:label}).parse(req.body);
    await tx(db,async c=>{await c.query('UPDATE topics SET title=$1 WHERE id=$2',[title,topic]);await event(c,row.workspace_id,'topics',topic);});return {ok:true};
  });
  app.get('/api/topics/:topic/messages',async req=>{
    const {topic}=z.object({topic:id}).parse(req.params);await topicAccess(db,(await user(db,req)).id,topic);const query=z.object({before:z.coerce.number().int().positive().optional(),after:z.coerce.number().int().nonnegative().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
    const result=await messages(db,topic,query);return {messages:result,hasMore:result.length===query.limit};
  });
  app.post('/api/topics/:topic/messages',async req=>{
    const person=await user(db,req);const {topic}=z.object({topic:id}).parse(req.params);const row=await topicAccess(db,person.id,topic);const input=sendSchema.parse(req.body);const parsed=parseMessage(input.body,input.humanOnly);
    if (input.body.length>cfg.maxMessageChars)throw new Problem(400,`Messages can contain up to ${cfg.maxMessageChars} characters.`);
    if (!parsed.body.trim() && !input.attachmentIds.length)throw new Problem(400,'Write a message or attach a file.');
    return tx(db,async c=>{
      // The topic lock serializes sequence allocation, idempotency, and lifecycle transitions.
      await c.query('SELECT id FROM topics WHERE id=$1 FOR UPDATE',[topic]);
      const prior=(await c.query('SELECT seq FROM messages WHERE topic_id=$1 AND author_id=$2 AND client_key=$3',[topic,person.id,input.clientKey])).rows[0];
      if(prior)return (await messages(c,topic,{before:prior.seq+1,after:prior.seq-1}))[0];
      for(const mention of input.mentions){
        const valid=mention.type==='human'?(await c.query('SELECT 1 FROM memberships WHERE user_id=$1 AND workspace_id=$2',[mention.id,row.workspace_id])).rowCount:(await c.query('SELECT 1 FROM bots WHERE id=$1 AND workspace_id=$2',[mention.id,row.workspace_id])).rowCount;
        if(!valid)throw new Problem(400,'A mention is not a member of this workspace.');
      }
      for(const attachment of input.attachmentIds){const a=(await c.query('SELECT * FROM attachments WHERE id=$1 FOR UPDATE',[attachment])).rows[0];if(!a||a.owner_id!==person.id||a.topic_id!==topic||a.message_id)throw new Problem(400,'Attachment is unavailable. Upload it again.');}
      const sent=await insertMessage(c,{topicId:topic,authorId:person.id,authorName:person.name,authorType:'human',body:parsed.body,humanOnly:parsed.humanOnly,clientKey:input.clientKey});
      for(const m of input.mentions)await c.query('INSERT INTO mentions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[sent.id,m.type,m.id]);
      await c.query('UPDATE attachments SET message_id=$1 WHERE id=ANY($2::uuid[])',[sent.id,input.attachmentIds]);
      if(!parsed.humanOnly)await schedule(c,topic,sent.id,input.mentions.filter(m=>m.type==='bot').map(m=>m.id));
      await event(c,row.workspace_id,'message',topic);
      return (await messages(c,topic,{after:sent.seq-1,before:sent.seq+1}))[0];
    });
  });
  app.post('/api/topics/:topic/read',async req=>{
    const person=await user(db,req);const {topic}=z.object({topic:id}).parse(req.params);const row=await topicAccess(db,person.id,topic);const {seq}=z.object({seq:z.number().int().nonnegative()}).parse(req.body);
    await tx(db,async c=>{await c.query('INSERT INTO read_cursors VALUES($1,$2,$3) ON CONFLICT(user_id,topic_id) DO UPDATE SET seq=GREATEST(read_cursors.seq,excluded.seq)',[person.id,topic,Math.min(seq,row.next_seq)]);await event(c,row.workspace_id,'read',topic);});return {ok:true};
  });
  app.get('/api/workspaces/:workspace/snapshot',async req=>{
    const person=await user(db,req);const {workspace}=z.object({workspace:id}).parse(req.params);const ws=await member(db,person.id,workspace);
    const channels=(await db.query('SELECT * FROM channels WHERE workspace_id=$1 ORDER BY name',[workspace])).rows;
    const topics=(await db.query(`SELECT t.*, COALESCE(r.seq,0) AS "readSeq", EXISTS(SELECT 1 FROM messages m JOIN mentions mm ON mm.message_id=m.id WHERE m.topic_id=t.id AND m.seq>COALESCE(r.seq,0) AND mm.target_type='human' AND mm.target_id=$2) AS mentioned FROM topics t JOIN channels c ON c.id=t.channel_id LEFT JOIN read_cursors r ON r.topic_id=t.id AND r.user_id=$2 WHERE c.workspace_id=$1 ORDER BY t.activity_at DESC`,[workspace,person.id])).rows;
    const members=(await db.query('SELECT u.id,u.name,u.avatar FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.name',[workspace])).rows;
    const bots=(await db.query(`SELECT b.*,h.name AS host_name,h.setup_error,(h.revoked_at IS NULL AND h.last_seen>now()-interval '45 seconds') AS online FROM bots b JOIN hosts h ON h.id=b.host_id WHERE b.workspace_id=$1 ORDER BY b.name`,[workspace])).rows;
    const sessions=(await db.query(`SELECT s.*,b.topic_id,b.bot_id,b.participation,b.epoch, p.label AS project_label, (SELECT count(*)::int FROM requests r WHERE r.session_id=s.id AND r.state='pending') AS queued FROM agent_sessions s JOIN bindings b ON b.id=s.binding_id AND b.generation=s.generation JOIN bots bot ON bot.id=b.bot_id JOIN projects p ON p.id=s.project_id WHERE bot.workspace_id=$1`,[workspace])).rows;
    const projects=(await db.query('SELECT p.id,p.host_id,p.label,p.available,bp.bot_id FROM projects p LEFT JOIN bot_projects bp ON bp.project_id=p.id JOIN hosts h ON h.id=p.host_id WHERE h.workspace_id=$1',[workspace])).rows;
    const hosts=(await db.query('SELECT id,name,owner_id,version,last_seen,revoked_at,setup_error FROM hosts WHERE workspace_id=$1 AND owner_id=$2',[workspace,person.id])).rows;
    const invites=ws.owner_id===person.id?(await db.query('SELECT id,expires_at,revoked_at FROM invites WHERE workspace_id=$1 ORDER BY expires_at DESC',[workspace])).rows:[];
    return {workspace:ws,channels,topics,members,bots,sessions,projects,hosts,invites};
  });
}
