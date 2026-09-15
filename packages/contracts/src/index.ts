import { z } from 'zod';
export const PROTOCOL_VERSION = 1;
export const CODEX_VERSION = '0.153.1';
export const id = z.string().uuid();
export const label = z.string().trim().min(1).max(80);
export const mentionSchema = z.object({id, type: z.enum(['human','bot'])}).strict();
export const attachmentSchema = z.object({id, name: z.string(), mediaType: z.string(), size: z.number().int().positive(), url: z.string().optional()});
export const sendSchema = z.object({body: z.string().max(8000), clientKey: id, humanOnly: z.boolean().default(false), mentions: z.array(mentionSchema).max(30).default([]), attachmentIds: z.array(id).max(10).default([])}).strict();
export const messageSchema = z.object({id: z.string(), seq: z.number().int(), body: z.string(), humanOnly: z.boolean(), author: z.object({id: z.string(), name: z.string(), type: z.enum(['human','bot','system'])}), createdAt: z.string(), mentions: z.array(mentionSchema), attachments: z.array(attachmentSchema)});
export type Message = z.infer<typeof messageSchema>;
export function parseMessage(text: string, toggle = false) {
  const match = /^\s*\/(?:nb|nobots)(?=\s|$)\s*/.exec(text);
  return {body: match ? text.slice(match[0].length) : text, humanOnly: toggle || !!match};
}
export function projectContext(history: Message[], options: {cursor: number; triggerSeqs: number[]; maxMessages: number; maxChars: number}) {
  const eligible = history.filter(m => !m.humanOnly && m.seq > options.cursor && m.author.type !== 'system').sort((a,b) => a.seq-b.seq);
  const triggers = new Set(options.triggerSeqs);
  const chosen = eligible.filter(m => triggers.has(m.seq));
  let chars = chosen.reduce((n,m)=>n+m.body.length,0);
  if (chars > options.maxChars || chosen.length > options.maxMessages) throw new Error('Current requests exceed the context limit. Split the request.');
  for (const m of [...eligible].reverse()) {
    if (triggers.has(m.seq)) continue;
    if (chosen.length >= options.maxMessages || chars + m.body.length > options.maxChars) break;
    chosen.push(m); chars += m.body.length;
  }
  chosen.sort((a,b)=>a.seq-b.seq);
  return {omitted: chosen.length < eligible.length, throughSeq: eligible.at(-1)?.seq ?? options.cursor, messages: chosen.map(({humanOnly: _, ...m})=>({...m, purpose: triggers.has(m.seq) ? 'request' as const : 'background' as const}))};
}
export const contextSchema = z.object({omitted: z.boolean(), throughSeq: z.number().int(), messages: z.array(messageSchema.omit({humanOnly:true}).extend({purpose:z.enum(['request','background'])})).max(50)});
export const outcomeSchema = z.object({kind:z.enum(['reply','wait','silent']), text:z.string().max(16000)}).strict().superRefine((v,c)=>{
  if (v.kind !== 'silent' && !v.text.trim()) c.addIssue({code:'custom',message:'Reply or question cannot be empty.'});
  if (v.kind === 'silent' && v.text !== '') c.addIssue({code:'custom',message:'Silent output must contain no text.'});
});
export type Outcome = z.infer<typeof outcomeSchema>;
export const dispatchSchema = z.object({type:z.literal('dispatch'), version:z.literal(PROTOCOL_VERSION), dispatchId:id, sessionId:id, botId:id, epoch:z.number().int().positive(), generation:z.number().int().positive(), projectId:id, localProjectId:id, threadId:z.string().nullable(), botName:label, topicTitle:label, channelName:label, workspaceName:label, context:contextSchema}).strict();
export type Dispatch = z.infer<typeof dispatchSchema>;
export const hostEventSchema = z.object({type:z.literal('event'), eventId:id, dispatchId:id, epoch:z.number().int(), kind:z.enum(['accepted','working','completed','failed','interrupted','uncertain','activity']), threadId:z.string().optional(), turnId:z.string().optional(), outcome:outcomeSchema.optional(), itemId:z.string().max(200).optional(), error:z.string().max(300).optional(), activity:z.enum(['command','fileChange','tool','compacting']).optional()}).strict();
export type HostEvent = z.infer<typeof hostEventSchema>;
export const hostInboundSchema = z.discriminatedUnion('type', [hostEventSchema, z.object({type:z.literal('heartbeat'),version:z.literal(PROTOCOL_VERSION),setupError:z.string().max(300).nullable(),projects:z.array(z.object({localId:id,label,available:z.boolean()}).strict()).max(100)}).strict()]);
export const hostCommandSchema = z.discriminatedUnion('type', [dispatchSchema,z.object({type:z.literal('cancel'),dispatchId:id,epoch:z.number().int()}),z.object({type:z.literal('eventAck'),eventId:id}),z.object({type:z.literal('reconcile'),dispatchIds:z.array(id)}),z.object({type:z.literal('revoked')})]);
