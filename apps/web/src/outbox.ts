import { z } from 'zod';
import { sendSchema } from '../../../packages/contracts/src/index';
export const pendingSchema = sendSchema.extend({ topic: z.string().uuid(), createdAt: z.string() });
export type Pending = z.infer<typeof pendingSchema>;
const key = (userId: string) => `porch:outbox:${userId}`;
export function readPending(userId: string): Pending[] {
  const stored = localStorage.getItem(key(userId));
  return stored ? z.array(pendingSchema).max(100).parse(JSON.parse(stored)) : [];
}
export function savePending(userId: string, entry: Pending) {
  const entries = readPending(userId);
  if (entries.length >= 100)
    throw new Error('Too many unsent messages. Retry them before sending more.');
  localStorage.setItem(
    key(userId),
    JSON.stringify([...entries.filter((p) => p.clientKey !== entry.clientKey), entry]),
  );
}
export function removePending(userId: string, clientKey: string) {
  localStorage.setItem(
    key(userId),
    JSON.stringify(readPending(userId).filter((p) => p.clientKey !== clientKey)),
  );
}
