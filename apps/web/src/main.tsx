import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import { type Message, parseMessage } from '../../../packages/contracts/src/index';
import { api, type Bot, type DisplayMessage, type Me, type Session, type Snapshot } from './types';
import { Composer } from './Composer';
import { Modal, NameDialog, Settings } from './Dialogs';
import './style.css';
const pathState = () => {
  const match = location.pathname.match(/^\/w\/([^/]+)(?:\/t\/([^/]+))?/);
  return { workspace: match?.[1] ?? '', topic: match?.[2] ?? '' };
};
function status(bot: Bot, session?: Session) {
  if (!bot.enabled) return 'Disabled';
  if (!bot.online) return 'Offline';
  if (bot.setup_error) return 'Needs setup';
  if (!session) return 'Available';
  if (session.state === 'stopping') return 'Stopping';
  if (session.participation === 'dismissed') return 'Dismissed';
  return (
    (
      {
        following: 'Following',
        queued: 'Queued',
        starting: 'Starting',
        working: 'Working',
        waiting: 'Waiting for you',
        error: 'Error',
        offline: 'Not sent to agent',
        uncertain: 'Check required',
      } as Record<string, string>
    )[session.state] ?? session.state
  );
}
function Avatar({ name, bot = false }: { name: string; bot?: boolean }) {
  return (
    <span aria-hidden="true" className={`avatar ${bot ? 'bot-avatar' : ''}`}>
      {bot ? '✳' : name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [route, setRoute] = useState(pathState),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [history, setHistory] = useState<DisplayMessage[]>([]),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState(''),
    [invite, setInvite] = useState(''),
    [nav, setNav] = useState(false),
    [connection, setConnection] = useState('Connecting'),
    [hasMore, setHasMore] = useState(false),
    [unseen, setUnseen] = useState(false),
    [selectedChannel, setSelectedChannel] = useState('');
  const list = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    snapshotRequest = useRef(0),
    historyRequest = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const current = snapshot?.topics.find((t) => t.id === route.topic),
    channelId = current?.channel_id || selectedChannel || snapshot?.channels[0]?.id;
  const channel = snapshot?.channels.find((c) => c.id === channelId);
  const participants = snapshot?.sessions.filter((s) => s.topic_id === route.topic) ?? [];
  const navigate = (workspace: string, topic = '') => {
    historyRequest.current++;
    window.history.pushState({}, '', `/w/${workspace}${topic ? `/t/${topic}` : ''}`);
    setRoute({ workspace, topic });
    setNav(false);
    setHistory([]);
    atBottom.current = true;
    setUnseen(false);
  };
  const refreshMe = useCallback(async () => {
    const result = await api<Me>('/me');
    setMe(result);
    return result;
  }, []);
  const reload = useCallback(async () => {
    const workspace = routeRef.current.workspace;
    if (!workspace) return;
    const request = ++snapshotRequest.current;
    const data = await api<Snapshot>(`/workspaces/${workspace}/snapshot`);
    if (request === snapshotRequest.current && workspace === routeRef.current.workspace)
      setSnapshot(data);
  }, []);
  const loadHistory = useCallback(async (initial = false) => {
    const topic = routeRef.current.topic;
    if (!topic) return;
    const request = ++historyRequest.current;
    const data = await api<{ messages: Message[]; hasMore: boolean }>(`/topics/${topic}/messages`);
    if (request !== historyRequest.current || topic !== routeRef.current.topic) return;
    setHistory((old) =>
      initial
        ? data.messages
        : [...old.filter((m) => !data.messages.some((n) => n.id === m.id)), ...data.messages].sort(
            (a, b) => a.seq - b.seq,
          ),
    );
    if (initial) setHasMore(data.hasMore);
    if (atBottom.current) {
      requestAnimationFrame(() => {
        list.current?.scrollTo({ top: list.current.scrollHeight });
      });
      if (document.visibilityState === 'visible' && data.messages.length)
        await api(`/topics/${topic}/read`, 'POST', { seq: data.messages.at(-1)!.seq });
    } else setUnseen(true);
  }, []);
  useEffect(() => {
    refreshMe().catch((e) => setError(e.message));
    const pop = () => {
      setRoute(pathState());
      setHistory([]);
      atBottom.current = true;
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [refreshMe]);
  useEffect(() => {
    if (
      me?.user &&
      !route.workspace &&
      !location.pathname.startsWith('/join/') &&
      me.workspaces.length
    )
      navigate(me.workspaces[0].id);
  }, [me, route.workspace]);
  useEffect(() => {
    if (!route.workspace || !me?.user) return;
    setSnapshot(null);
    reload().catch((e) => setError(e.message));
  }, [route.workspace, me?.user?.id, reload]);
  useEffect(() => {
    if (!route.topic) {
      setHistory([]);
      return;
    }
    atBottom.current = true;
    loadHistory(true)
      .then(() => {
        const message = location.hash.slice(1);
        if (message)
          requestAnimationFrame(() =>
            document.getElementById(message)?.scrollIntoView({ block: 'center' }),
          );
      })
      .catch((e) => setError(e.message));
  }, [route.topic, loadHistory]);
  useEffect(() => {
    if (!route.workspace || !me?.user) return;
    let socket: WebSocket,
      timer: ReturnType<typeof setTimeout>,
      closed = false,
      after = '0',
      delay = 500;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/workspaces/${route.workspace}/events?after=${after}`,
      );
      socket.onopen = () => {
        setConnection('Connected');
        delay = 500;
      };
      socket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type !== 'events') return;
        after = data.events.at(-1)?.id ?? after;
        reload().catch((e) => setError(e.message));
        if (
          data.events.some(
            (v: { kind: string; topic_id: string }) =>
              v.kind === 'message' && v.topic_id === routeRef.current.topic,
          )
        )
          loadHistory().catch((e) => setError(e.message));
      };
      socket.onclose = (e) => {
        setConnection(e.code === 1008 ? 'Access ended' : 'Reconnecting');
        if (e.code === 1008) {
          setError('Your workspace access ended.');
          return;
        }
        if (!closed) {
          timer = setTimeout(connect, delay + Math.random() * 300);
          delay = Math.min(15000, delay * 2);
        }
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [route.workspace, me?.user?.id, reload, loadHistory]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(
    body: string,
    humanOnly: boolean,
    mentions: Message['mentions'],
    attachmentIds: string[],
  ) {
    const topic = route.topic,
      clientKey = crypto.randomUUID(),
      parsed = parseMessage(body, humanOnly);
    const pending: DisplayMessage = {
      id: clientKey,
      seq: 2147483647,
      body: parsed.body,
      humanOnly: parsed.humanOnly,
      author: { id: me!.user!.id, name: me!.user!.name, type: 'human' },
      createdAt: new Date().toISOString(),
      mentions,
      attachments: [],
      delivery: 'sending',
    };
    const deliver = async () => {
      setHistory((old) => old.map((m) => (m.id === clientKey ? { ...m, delivery: 'sending' } : m)));
      try {
        const sent = await api<Message>(`/topics/${topic}/messages`, 'POST', {
          body,
          humanOnly,
          mentions,
          attachmentIds,
          clientKey,
        });
        if (routeRef.current.topic === topic)
          setHistory((old) =>
            [...old.filter((m) => m.id !== clientKey && m.id !== sent.id), sent].sort(
              (a, b) => a.seq - b.seq,
            ),
          );
        await reload();
      } catch (e) {
        if (routeRef.current.topic === topic)
          setHistory((old) =>
            old.map((m) => (m.id === clientKey ? { ...m, delivery: 'failed', retry: deliver } : m)),
          );
        setError((e as Error).message);
      }
    };
    setHistory((old) => [...old, pending]);
    atBottom.current = true;
    requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }));
    await deliver();
  }
  async function older() {
    if (!history.length) return;
    const scroll = list.current!,
      height = scroll.scrollHeight;
    const data = await api<{ messages: Message[]; hasMore: boolean }>(
      `/topics/${route.topic}/messages?before=${history[0].seq}`,
    );
    setHistory((old) => [...data.messages, ...old]);
    setHasMore(data.hasMore);
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight - height;
    });
  }
  const startFresh = (session: Session) => {
    setDialog(`fresh:${session.id}`);
  };
  if (!me)
    return (
      <main className="welcome">
        <div className="wordmark">
          porch<span>✳</span>
        </div>
        <p>{error || 'Opening the door…'}</p>
      </main>
    );
  if (!me.user)
    return (
      <main className="welcome">
        <div className="welcome-card">
          <div className="wordmark">
            porch<span>✳</span>
          </div>
          <span className="eyebrow">A place to build together</span>
          <h1>
            Good company.
            <br />
            Great things in progress.
          </h1>
          <p>
            Bring your friends, your ideas, and your coding agents. Give every conversation a place
            to grow.
          </p>
          {me.githubReady && (
            <a className="primary" href="/api/auth/github">
              Continue with GitHub →
            </a>
          )}
          {me.devAuth && (
            <div className="dev-signin">
              <small>Local development accounts</small>
              {['Alex', 'Sam', 'Outsider'].map((name) => (
                <button
                  key={name}
                  onClick={() =>
                    action(async () => {
                      await api('/auth/dev', 'POST', { name: name.toLowerCase() });
                      await refreshMe();
                    })
                  }
                >
                  Continue as {name}
                </button>
              ))}
            </div>
          )}
          {!me.githubReady && !me.devAuth && (
            <p role="alert">GitHub sign-in needs setup. Ask the service owner to configure it.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <aside className="welcome-art">
          <span>
            Make a little
            <br />
            room for
            <br />
            <em>possibility.</em>
          </span>
          <div className="art-window">
            <i />
            <i />
            <i />
            <i />
          </div>
          <small>Your people. Your projects. Your Porch.</small>
        </aside>
      </main>
    );
  const joinToken = location.pathname.match(/^\/join\/([^/]+)$/)?.[1];
  if (joinToken)
    return (
      <main className="welcome">
        <div className="welcome-card">
          <div className="wordmark">
            porch<span>✳</span>
          </div>
          <h1>There’s room for you.</h1>
          <p>
            Join this workspace as {me.user.name}. All members can read its topics and direct its
            enabled bots.
          </p>
          <button
            className="primary"
            onClick={() =>
              action(async () => {
                const w = await api<{ id: string }>('/invites/join', 'POST', { token: joinToken });
                await refreshMe();
                navigate(w.id);
              })
            }
          >
            Join workspace
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    );
  return (
    <div className={`app ${nav ? 'nav-open' : ''}`}>
      <aside className="workspace-nav">
        <div className="wordmark">
          porch<span>✳</span>
        </div>
        <label className="sr-only" htmlFor="workspace">
          Workspace
        </label>
        <select id="workspace" value={route.workspace} onChange={(e) => navigate(e.target.value)}>
          <option value="" disabled>
            Your workspaces
          </option>
          {me.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button className="subtle" onClick={() => setDialog('workspace')}>
          ＋ Create workspace
        </button>
        <div className="nav-label">
          <span>CHANNELS</span>
          <button
            aria-label="Create channel"
            disabled={!snapshot}
            onClick={() => setDialog('channel')}
          >
            ＋
          </button>
        </div>
        <nav aria-label="Channels">
          {snapshot?.channels.map((c) => {
            const unread = snapshot.topics
              .filter((t) => t.channel_id === c.id)
              .some((t) => t.next_seq > t.readSeq);
            return (
              <button
                key={c.id}
                className={`channel ${channelId === c.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedChannel(c.id);
                  if (current?.channel_id !== c.id) navigate(route.workspace);
                  setNav(true);
                }}
              >
                <span>
                  <b>#</b>
                  {c.name}
                </span>
                {unread && <i className="unread-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="nav-bottom">
          <div className="little-note">
            A shared space
            <br />
            for work in progress.
          </div>
          <button disabled={!snapshot} onClick={() => setDialog('settings')}>
            ⚙ <span>Workspace settings</span>
          </button>
          <button
            aria-label="Invite friends"
            disabled={!snapshot || snapshot.workspace.owner_id !== me.user.id}
            onClick={() =>
              action(async () => {
                const data = await api<{ url: string }>(
                  `/workspaces/${route.workspace}/invites`,
                  'POST',
                  {},
                );
                setInvite(data.url);
                setDialog('invite');
              })
            }
          >
            ↗ <span>Invite friends</span>
          </button>
          <div className="user-row">
            <Avatar name={me.user.name} />
            <span>
              {me.user.name}
              <small>{connection}</small>
            </span>
            <button
              title="Sign out"
              aria-label="Sign out"
              onClick={() =>
                action(async () => {
                  await api('/auth/logout', 'POST', {});
                  location.href = '/';
                })
              }
            >
              ↪
            </button>
          </div>
        </div>
      </aside>
      <aside className="topics-panel">
        <header>
          <div>
            <span className="eyebrow">CONVERSATIONS</span>
            <h2>{channel ? `# ${channel.name}` : 'Your workspace'}</h2>
          </div>
          {channel && (
            <button
              className="icon-button"
              aria-label="Rename channel"
              onClick={() => setDialog('rename-channel')}
            >
              ⋯
            </button>
          )}
        </header>
        <button
          className="new-topic"
          aria-label="New topic"
          disabled={!channel}
          onClick={() => setDialog('topic')}
        >
          ＋ New topic
        </button>
        <div className="topic-list">
          {snapshot?.topics
            .filter((t) => t.channel_id === channelId)
            .map((t) => (
              <button
                key={t.id}
                className={`topic ${route.topic === t.id ? 'selected' : ''}`}
                onClick={() => navigate(route.workspace, t.id)}
              >
                <div>
                  <strong>{t.title}</strong>
                  {t.next_seq > t.readSeq && (
                    <span className={t.mentioned ? 'mention-dot' : 'unread-dot'}>
                      {t.mentioned ? '@' : ''}
                    </span>
                  )}
                </div>
                <small>{t.next_seq ? `${t.next_seq} messages` : 'Start the conversation'}</small>
              </button>
            ))}
        </div>
        <footer>
          <span className="presence-dot" />
          {snapshot?.members.length ?? 0} members in this workspace
        </footer>
      </aside>
      <main className="conversation">
        <header className="topic-header">
          <button
            className="icon-button mobile-nav"
            aria-label="Open navigation"
            onClick={() => setNav(!nav)}
          >
            ☰
          </button>
          <div>
            <span className="eyebrow">{channel ? `# ${channel.name}` : 'WELCOME TO PORCH'}</span>
            <h1>{current?.title ?? 'What are you making?'}</h1>
          </div>
          <div className="topic-actions">
            {current && (
              <>
                <button
                  className="icon-button"
                  aria-label="Rename topic"
                  onClick={() => setDialog('rename-topic')}
                >
                  ✎
                </button>
                <button onClick={() => setDialog('bots')}>
                  ✳ <span>Bots & projects</span>
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {!!participants.length && (
          <div className="bot-bar">
            {participants.map((s) => {
              const b = snapshot!.bots.find((b) => b.id === s.bot_id)!;
              return (
                <button key={s.id} onClick={() => setDialog('bots')}>
                  <span
                    className={`status-dot ${['working', 'starting'].includes(s.state) ? 'pulse' : ''}`}
                  />
                  <strong>{b.name}</strong>
                  <span>
                    {status(b, s)}
                    {s.queued ? ` · ${s.queued} queued` : ''}
                  </span>
                  <span className="project-name">{s.project_label}</span>
                </button>
              );
            })}
          </div>
        )}
        {!current ? (
          <div className="empty">
            <span className="empty-symbol">✳</span>
            <span className="eyebrow">BETTER WITH COMPANY</span>
            <h2>A conversation is a good start.</h2>
            <p>
              Choose a topic to catch up, or start one for
              <br />
              the next thing you want to make.
            </p>
            <button className="primary" onClick={() => setDialog(snapshot ? 'topic' : 'workspace')}>
              {snapshot ? 'Start a topic' : 'Create workspace'}
            </button>
          </div>
        ) : (
          <>
            <div
              className="message-list"
              ref={list}
              onScroll={() => {
                const el = list.current!;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                if (atBottom.current) {
                  setUnseen(false);
                  const latest = history.filter((m) => !m.delivery).at(-1)?.seq;
                  if (latest && latest > (current.readSeq ?? 0))
                    api(`/topics/${route.topic}/read`, 'POST', { seq: latest }).catch((e) =>
                      setError(e.message),
                    );
                }
              }}
            >
              {hasMore && (
                <button className="older" onClick={() => action(older)}>
                  Load older messages
                </button>
              )}
              <div className="topic-intro">
                <span>↳</span>
                <h2>{current.title}</h2>
                <p>The start of a shared conversation. Make yourself at home.</p>
              </div>
              {history.map((m) => (
                <article
                  className={`message ${m.humanOnly ? 'private-message' : ''} ${m.author.type === 'system' ? 'system-message' : ''}`}
                  key={m.id}
                  id={`message-${m.id}`}
                >
                  <Avatar name={m.author.name} bot={m.author.type === 'bot'} />
                  <div className="message-content">
                    <div className="message-meta">
                      <strong>{m.author.name}</strong>
                      {m.author.type === 'bot' && <span className="bot-label">BOT</span>}
                      <a href={`#message-${m.id}`} title={new Date(m.createdAt).toLocaleString()}>
                        <time>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </time>
                      </a>
                      {m.humanOnly && <span className="human-label">◇ Humans only</span>}
                      {m.delivery === 'sending' && <small>Sending…</small>}
                      {m.delivery === 'failed' && (
                        <button className="inline-error" onClick={m.retry}>
                          Send failed · Retry
                        </button>
                      )}
                    </div>
                    <div className="markdown">
                      <Markdown
                        skipHtml
                        allowedElements={[
                          'p',
                          'ul',
                          'ol',
                          'li',
                          'a',
                          'strong',
                          'em',
                          'code',
                          'pre',
                          'blockquote',
                          'br',
                          'hr',
                        ]}
                        components={{
                          a: ({ children, ...props }) => (
                            <a {...props} target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {m.body}
                      </Markdown>
                    </div>
                    {m.attachments.map((a) => (
                      <div className="attachment" key={a.id}>
                        {a.mediaType.startsWith('image/') && (
                          <a href={`/api/attachments/${a.id}`}>
                            <img src={`/api/attachments/${a.id}?preview=1`} alt={a.name} />
                          </a>
                        )}
                        <a href={`/api/attachments/${a.id}`} download>
                          {a.name} <small>{Math.ceil(a.size / 1024)} KB ↓</small>
                        </a>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {unseen && (
              <button
                className="new-messages"
                onClick={() => {
                  atBottom.current = true;
                  list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
                  setUnseen(false);
                }}
              >
                New messages ↓
              </button>
            )}
            <div className="composer-wrap">
              <Composer
                key={route.topic}
                topicId={route.topic}
                bots={snapshot!.bots}
                members={snapshot!.members}
                maxChars={me.maxMessageChars}
                maxFileBytes={me.maxFileBytes}
                onSend={send}
              />
              <p className="composer-hint">
                Enter to send · Shift + Enter for a new line <span>Built with company.</span>
              </p>
            </div>
          </>
        )}
      </main>
      {dialog === 'workspace' && (
        <NameDialog
          title="Create workspace"
          label="Workspace name"
          onClose={() => setDialog('')}
          onSave={async (name) => {
            const w = await api<{ id: string }>('/workspaces', 'POST', { name });
            await refreshMe();
            navigate(w.id);
          }}
        />
      )}
      {dialog === 'channel' && (
        <NameDialog
          title="Create channel"
          label="Channel name"
          onClose={() => setDialog('')}
          onSave={async (name) => {
            const c = await api<{ id: string }>(`/workspaces/${route.workspace}/channels`, 'POST', {
              name,
            });
            setSelectedChannel(c.id);
            navigate(route.workspace);
            await reload();
          }}
        />
      )}
      {dialog === 'topic' && channel && (
        <NameDialog
          title="New topic"
          label="Topic title"
          onClose={() => setDialog('')}
          onSave={async (title) => {
            const t = await api<{ id: string }>(`/channels/${channel.id}/topics`, 'POST', {
              title,
            });
            await reload();
            navigate(route.workspace, t.id);
          }}
        />
      )}
      {dialog === 'rename-topic' && current && (
        <NameDialog
          title="Rename topic"
          label="Topic title"
          initial={current.title}
          onClose={() => setDialog('')}
          onSave={async (title) => {
            await api(`/topics/${current.id}`, 'PATCH', { title });
            await reload();
          }}
        />
      )}
      {dialog === 'rename-channel' && channel && (
        <NameDialog
          title="Rename channel"
          label="Channel name"
          initial={channel.name}
          onClose={() => setDialog('')}
          onSave={async (name) => {
            await api(`/channels/${channel.id}`, 'PATCH', { name });
            await reload();
          }}
        />
      )}
      {dialog === 'invite' && (
        <Modal title="Make room for a friend" onClose={() => setDialog('')}>
          <p>
            Anyone with this link can join for the next 7 days. You can revoke it in workspace
            settings.
          </p>
          <label>
            Invitation link
            <input readOnly value={invite} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="primary"
            onClick={() => action(() => navigator.clipboard.writeText(invite))}
          >
            Copy invitation link
          </button>
        </Modal>
      )}
      {dialog === 'settings' && snapshot && (
        <Settings
          snapshot={snapshot}
          userId={me.user.id}
          onClose={() => setDialog('')}
          reload={reload}
        />
      )}
      {dialog === 'bots' && snapshot && (
        <Modal title="Bots & projects" onClose={() => setDialog('')}>
          <p>
            Mention a bot in a message to invite it. Once invited, it follows the topic until
            dismissed.
          </p>
          {!snapshot.bots.length && <p>No bots yet. Connect a Mac in workspace settings.</p>}
          {snapshot.bots.map((b) => {
            const s = participants.find((s) => s.bot_id === b.id);
            return (
              <section className="settings-section" key={b.id}>
                <div className="settings-row">
                  <div>
                    <strong>@{b.handle}</strong>
                    <small>
                      {status(b, s)} · Runs on {b.host_name}
                    </small>
                  </div>
                  <Avatar name={b.name} bot />
                </div>
                {s && (
                  <>
                    <p>{s.project_label}</p>
                    {s.error && <p className="inline-error">{s.error}</p>}
                    <div className="control-row">
                      <button
                        onClick={() =>
                          action(() => api(`/sessions/${s.id}/action`, 'POST', { action: 'stop' }))
                        }
                      >
                        Stop current work
                      </button>
                      <button
                        onClick={() =>
                          action(() =>
                            api(`/sessions/${s.id}/action`, 'POST', { action: 'dismiss' }),
                          )
                        }
                      >
                        Dismiss
                      </button>
                      <button onClick={() => startFresh(s)}>Start fresh…</button>
                      {['offline', 'uncertain', 'error'].includes(s.state) && (
                        <button
                          onClick={() =>
                            action(() =>
                              api(`/sessions/${s.id}/action`, 'POST', { action: 'retry' }),
                            )
                          }
                        >
                          Retry last request
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </Modal>
      )}
      {dialog.startsWith('fresh:') && snapshot && (
        <FreshDialog
          session={participants.find((s) => s.id === dialog.slice(6))!}
          snapshot={snapshot}
          onClose={() => setDialog('')}
          onSave={async (sessionId, projectId) => {
            await api(`/sessions/${sessionId}/action`, 'POST', {
              action: 'fresh',
              projectId,
              confirmed: true,
            });
            await reload();
          }}
        />
      )}
    </div>
  );
}
function FreshDialog({
  session,
  snapshot,
  onClose,
  onSave,
}: {
  session: Session;
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (id: string, project: string) => Promise<void>;
}) {
  const [project, setProject] = useState(session.project_id),
    [error, setError] = useState('');
  return (
    <Modal title="Start a fresh session?" onClose={onClose}>
      <p>
        Current work will be stopped. Chat history stays visible. The next message starts the new
        conversation. Project files and instructions stay as they are.
      </p>
      <label>
        Project
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          {snapshot.projects
            .filter((p) => p.bot_id === session.bot_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </select>
      </label>
      <button
        className="primary"
        onClick={async () => {
          try {
            await onSave(session.id, project);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Start fresh
      </button>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
