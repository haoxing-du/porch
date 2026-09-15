import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { id } from '../../../packages/contracts/src/index';
import { user, topicAccess, member, Problem, uid } from './core';
import { Storage } from './storage';
export function attachmentRoutes(app: FastifyInstance, db: pg.Pool, storage: Storage) {
  app.post('/api/topics/:topic/attachments', async (req) => {
    const person = await user(db, req);
    const { topic } = z.object({ topic: id }).parse(req.params);
    const t = await topicAccess(db, person.id, topic);
    const file = await req.file();
    if (!file) throw new Problem(400, 'Choose a file.');
    const data = await file.toBuffer();
    if (!data.length) throw new Problem(400, 'The file is empty.');
    const key = uid(),
      attachmentId = uid(),
      name = file.filename.replace(/[\x00-\x1f/\\]/g, '_').slice(0, 200) || 'attachment';
    // Only recognize safe bitmap types from their byte signatures. Never trust supplied HTML/SVG MIME types.
    const mediaType = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : data[0] === 255 && data[1] === 216 && data[2] === 255
        ? 'image/jpeg'
        : data.subarray(0, 6).toString() === 'GIF89a' || data.subarray(0, 6).toString() === 'GIF87a'
          ? 'image/gif'
          : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : 'application/octet-stream';
    await storage.put(key, data);
    try {
      await db.query(
        'INSERT INTO attachments(id,workspace_id,owner_id,topic_id,object_key,name,media_type,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [attachmentId, t.workspace_id, person.id, topic, key, name, mediaType, data.length],
      );
    } catch (error) {
      await storage.remove(key);
      throw error;
    }
    return { id: attachmentId, name, mediaType, size: data.length };
  });
  app.get('/api/attachments/:attachment', async (req, reply) => {
    const person = await user(db, req);
    const { attachment } = z.object({ attachment: id }).parse(req.params);
    const a = (await db.query('SELECT * FROM attachments WHERE id=$1', [attachment])).rows[0];
    if (!a) throw new Problem(404, 'Attachment not found.');
    await member(db, person.id, a.workspace_id);
    if (!a.message_id && a.owner_id !== person.id)
      throw new Problem(403, 'Attachment is not shared yet.');
    const inline =
      a.media_type.startsWith('image/') && (req.query as { preview?: string }).preview === '1';
    reply
      .header('Content-Type', inline ? a.media_type : 'application/octet-stream')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      )
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(await storage.get(a.object_key));
  });
}
