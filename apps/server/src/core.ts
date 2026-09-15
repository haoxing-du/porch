import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { DB } from './db';
import type { Message } from '../../../packages/contracts/src/index';
export const uid = randomUUID;
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Problem extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export async function user(db: DB, req: FastifyRequest) {
  const token = req.cookies.porch;
  if (!token) throw new Problem(401, 'Sign in to continue.');
  const row = (
    await db.query(
      'SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [hash(token)],
    )
  ).rows[0];
  if (!row) throw new Problem(401, 'Your sign-in expired. Sign in again.');
  return row as { id: string; name: string; avatar: string | null };
}
export async function member(db: DB, userId: string, workspaceId: string, owner = false) {
  const row = (
    await db.query(
      'SELECT w.* FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2',
      [workspaceId, userId],
    )
  ).rows[0];
  if (!row || (owner && row.owner_id !== userId))
    throw new Problem(
      403,
      owner ? 'Only the workspace owner can do this.' : 'You do not have access to this workspace.',
    );
  return row;
}
export async function topicAccess(db: DB, userId: string, topicId: string) {
  const row = (
    await db.query(
      'SELECT t.*, c.workspace_id, c.name AS channel_name FROM topics t JOIN channels c ON c.id=t.channel_id WHERE t.id=$1',
      [topicId],
    )
  ).rows[0];
  if (!row) throw new Problem(404, 'Topic not found.');
  await member(db, userId, row.workspace_id);
  return row;
}
export async function event(db: DB, workspace: string, kind: string, topic?: string) {
  await db.query('INSERT INTO events(workspace_id,kind,topic_id) VALUES($1,$2,$3)', [
    workspace,
    kind,
    topic ?? null,
  ]);
}
export async function messages(
  db: DB,
  topicId: string,
  opts: { before?: number; after?: number; limit?: number; eligible?: boolean } = {},
): Promise<Message[]> {
  const rows = (
    await db.query(
      `SELECT m.* FROM messages m WHERE topic_id=$1 AND seq<$2 AND seq>$3 ${opts.eligible ? 'AND NOT human_only' : ''} ORDER BY seq DESC LIMIT $4`,
      [topicId, opts.before ?? 2147483647, opts.after ?? 0, opts.limit ?? 50],
    )
  ).rows.reverse();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const mentions = (
    await db.query('SELECT * FROM mentions WHERE message_id=ANY($1::uuid[])', [ids])
  ).rows;
  const attachments = (
    await db.query('SELECT * FROM attachments WHERE message_id=ANY($1::uuid[])', [ids])
  ).rows;
  const deliveries = opts.eligible
    ? []
    : (
        await db.query(
          'SELECT r.message_id,r.state,r.session_id,b.bot_id,bot.name FROM requests r JOIN agent_sessions s ON s.id=r.session_id JOIN bindings b ON b.id=s.binding_id JOIN bots bot ON bot.id=b.bot_id WHERE r.message_id=ANY($1::uuid[])',
          [ids],
        )
      ).rows;
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    body: r.body,
    humanOnly: r.human_only,
    ...(opts.eligible
      ? {}
      : {
          agentDelivery: deliveries
            .filter((d) => d.message_id === r.id)
            .map((d) => ({
              botId: d.bot_id,
              botName: d.name,
              sessionId: d.session_id,
              state: d.state,
            })),
        }),
    author: { id: r.author_id, name: r.author_name, type: r.author_type },
    createdAt: r.created_at.toISOString(),
    mentions: mentions
      .filter((m) => m.message_id === r.id)
      .map((m) => ({ id: m.target_id, type: m.target_type })),
    attachments: attachments
      .filter((a) => a.message_id === r.id)
      .map((a) => ({ id: a.id, name: a.name, mediaType: a.media_type, size: a.size })),
  }));
}
export async function insertMessage(
  db: DB,
  input: {
    topicId: string;
    authorId: string;
    authorName: string;
    authorType: string;
    body: string;
    humanOnly?: boolean;
    clientKey: string;
  },
) {
  const seq = (
    await db.query(
      'UPDATE topics SET next_seq=next_seq+1,activity_at=now() WHERE id=$1 RETURNING next_seq',
      [input.topicId],
    )
  ).rows[0].next_seq;
  const messageId = uid();
  await db.query(
    'INSERT INTO messages(id,topic_id,seq,author_type,author_id,author_name,body,human_only,client_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      messageId,
      input.topicId,
      seq,
      input.authorType,
      input.authorId,
      input.authorName,
      input.body,
      input.humanOnly ?? false,
      input.clientKey,
    ],
  );
  return { id: messageId, seq };
}
