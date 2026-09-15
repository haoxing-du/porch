import { useEffect, useRef, useState } from 'react';
import { parseMessage, mentionSchema, type Message } from '../../../packages/contracts/src/index';
import type { Bot, Person } from './types';
import { z } from 'zod';
const draftSchema = z.object({
  text: z.string(),
  humanOnly: z.boolean(),
  mentions: z.array(mentionSchema),
  files: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
const emptyDraft = () => ({ text: '', humanOnly: false, mentions: [], files: [] });
export function Composer({
  topicId,
  userId,
  bots,
  members,
  maxChars,
  maxFileBytes,
  onSend,
}: {
  topicId: string;
  userId: string;
  bots: Bot[];
  members: Person[];
  maxChars: number;
  maxFileBytes: number;
  onSend: (
    body: string,
    humanOnly: boolean,
    mentions: Message['mentions'],
    attachmentIds: string[],
  ) => Promise<void>;
}) {
  const key = `porch:draft:${userId}:${topicId}`;
  const [saved] = useState(() => {
    try {
      const value = localStorage.getItem(key);
      return { draft: value ? draftSchema.parse(JSON.parse(value)) : emptyDraft(), invalid: false };
    } catch {
      return { draft: emptyDraft(), invalid: true };
    }
  });
  const [blocked, setBlocked] = useState(saved.invalid);
  const [text, setText] = useState(saved.draft.text);
  const [humanOnly, setHumanOnly] = useState(saved.draft.humanOnly);
  const [mentions, setMentions] = useState<Message['mentions']>(saved.draft.mentions);
  const [files, setFiles] = useState<{ id: string; name: string }[]>(saved.draft.files);
  const [upload, setUpload] = useState<number | null>(null);
  const [error, setError] = useState(
    saved.invalid ? 'The saved draft cannot be read safely. Clear it to start a new message.' : '',
  );
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (blocked) return;
    try {
      localStorage.setItem(key, JSON.stringify({ text, humanOnly, mentions, files }));
    } catch {
      setError('The draft could not be saved. Free browser storage before continuing.');
      setBlocked(true);
    }
  }, [key, text, humanOnly, mentions, files, blocked]);
  const parsed = parseMessage(text, humanOnly);
  const query = /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
  const candidates = [
    ...bots.map((b) => ({
      id: b.id,
      name: b.handle,
      label: b.name,
      type: 'bot' as const,
      detail: !b.enabled ? 'Disabled' : b.online ? 'Available' : 'Offline',
    })),
    ...members.map((p) => ({
      id: p.id,
      name: p.name,
      label: p.name,
      type: 'human' as const,
      detail: 'Member',
    })),
  ]
    .filter((p) => query !== undefined && p.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);
  async function submit() {
    if (
      blocked ||
      submitting.current ||
      upload !== null ||
      text.length > maxChars ||
      (!parsed.body.trim() && !files.length)
    )
      return;
    submitting.current = true;
    try {
      await onSend(
        text,
        humanOnly,
        mentions.filter((m) => {
          const name =
            m.type === 'bot'
              ? bots.find((b) => b.id === m.id)?.handle
              : members.find((p) => p.id === m.id)?.name;
          return name && text.includes('@' + name);
        }),
        files.map((f) => f.id),
      );
      setText('');
      setFiles([]);
      setMentions([]);
      setHumanOnly(false);
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
    }
  }
  function attach(file: File) {
    if (file.size > maxFileBytes) {
      setError(`Files must be ${Math.round(maxFileBytes / 1048576)} MB or smaller.`);
      return;
    }
    setError('');
    setUpload(0);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/topics/${topicId}/attachments`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUpload(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      setError('Upload failed. Choose the file to try again.');
      setUpload(null);
    };
    xhr.onload = () => {
      setUpload(null);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) throw new Error(data.error);
        setFiles((old) => [...old, data]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed. Choose the file to try again.');
      }
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  }
  return (
    <section
      className={`composer ${parsed.humanOnly ? 'human-only' : ''}`}
      aria-label="Write a message"
    >
      {blocked && (
        <button
          onClick={() => {
            localStorage.removeItem(key);
            setBlocked(false);
            setError('');
          }}
        >
          Clear unreadable draft
        </button>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!!files.length && (
        <div className="attachment-chips">
          {files.map((f) => (
            <span key={f.id}>
              {f.name}
              <button
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((a) => a.id !== f.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {upload !== null && <p role="status">Uploading… {upload}%</p>}
      {!!candidates.length && (
        <div className="suggestions" aria-label="Mention suggestions">
          {candidates.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setText(text.replace(/@[^\s@]*$/, `@${p.name} `));
                setMentions((old) => [
                  ...old.filter((m) => m.id !== p.id),
                  { id: p.id, type: p.type },
                ]);
                input.current?.focus();
              }}
            >
              <span>
                {p.type === 'bot' ? '✳' : '@'} {p.label}
              </span>
              <small>{p.detail}</small>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        aria-label="Message"
        placeholder="Write a message, or @mention a bot…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-footer">
        <div className="composer-tools">
          <label className="attach-button" title="Attach a file">
            ＋<span className="sr-only">Attach file</span>
            <input
              type="file"
              disabled={blocked || upload !== null || files.length >= 10}
              onChange={(e) => {
                if (e.target.files?.[0]) attach(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
          <button
            className={`toggle ${parsed.humanOnly ? 'selected' : ''}`}
            aria-pressed={parsed.humanOnly}
            onClick={() => setHumanOnly(!humanOnly)}
          >
            {parsed.humanOnly ? '◈ Humans only' : '◇ Humans only'}
          </button>
        </div>
        <div className="send-tools">
          <small className={text.length > maxChars ? 'over-limit' : ''}>
            {text.length.toLocaleString()} / {maxChars.toLocaleString()}
          </small>
          <button
            className="primary send"
            aria-label="Send message"
            disabled={
              blocked ||
              upload !== null ||
              text.length > maxChars ||
              (!parsed.body.trim() && !files.length)
            }
            onClick={submit}
          >
            Send <span>↑</span>
          </button>
        </div>
      </div>
    </section>
  );
}
