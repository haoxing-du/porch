import { useEffect, useRef, useState } from 'react';
import { parseMessage, type Message } from '../../../packages/contracts/src/index';
import type { Bot, Person } from './types';
export function Composer({
  topicId,
  bots,
  members,
  maxChars,
  maxFileBytes,
  onSend,
}: {
  topicId: string;
  bots: Bot[];
  members: Person[];
  maxChars: number;
  maxFileBytes: number;
  onSend: (
    body: string,
    humanOnly: boolean,
    mentions: Message['mentions'],
    attachmentIds: string[],
  ) => void;
}) {
  const key = `porch:draft:${topicId}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? '');
  const [humanOnly, setHumanOnly] = useState(false);
  const [mentions, setMentions] = useState<Message['mentions']>([]);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    localStorage.setItem(key, text);
  }, [key, text]);
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
  function submit() {
    if (upload !== null || text.length > maxChars || (!parsed.body.trim() && !files.length)) return;
    onSend(
      text,
      humanOnly,
      mentions,
      files.map((f) => f.id),
    );
    setText('');
    setFiles([]);
    setMentions([]);
    setHumanOnly(false);
    input.current?.focus();
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
              disabled={upload !== null || files.length >= 10}
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
              upload !== null || text.length > maxChars || (!parsed.body.trim() && !files.length)
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
