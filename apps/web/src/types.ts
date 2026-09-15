import type { Message } from '../../../packages/contracts/src/index';
export type Person = { id: string; name: string; avatar?: string };
export type Workspace = { id: string; name: string; owner_id: string };
export type Topic = {
  id: string;
  channel_id: string;
  title: string;
  next_seq: number;
  readSeq: number;
  mentioned: boolean;
};
export type Bot = {
  id: string;
  name: string;
  handle: string;
  owner_id: string;
  host_id: string;
  host_name: string;
  online: boolean;
  enabled: boolean;
  setup_error: string | null;
  default_project_id: string;
  shared: boolean;
};
export type Session = {
  id: string;
  topic_id: string;
  bot_id: string;
  participation: string;
  state: string;
  error: string | null;
  project_id: string;
  project_label: string;
  queued: number;
  generation: number;
};
export type Project = {
  id: string;
  host_id: string;
  label: string;
  available: boolean;
  bot_id: string | null;
};
export type Snapshot = {
  workspace: Workspace;
  channels: { id: string; name: string }[];
  topics: Topic[];
  members: Person[];
  bots: Bot[];
  sessions: Session[];
  projects: Project[];
  hosts: {
    id: string;
    name: string;
    owner_id: string;
    revoked_at: string | null;
    setup_error: string | null;
  }[];
  invites: { id: string; expires_at: string; revoked_at: string | null }[];
};
export type Me = {
  user: Person | null;
  devAuth: boolean;
  githubReady: boolean;
  workspaces: Workspace[];
  maxMessageChars: number;
  maxFileBytes: number;
};
export type DisplayMessage = Message & { delivery?: 'sending' | 'failed'; retry?: () => void };
export async function api<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const result = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
