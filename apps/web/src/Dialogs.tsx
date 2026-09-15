import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Snapshot } from './types';
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function NameDialog({
  title,
  label,
  initial = '',
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(name);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {label}
          <input
            autoFocus
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {initial ? 'Save' : 'Create'}
        </button>
      </form>
    </Modal>
  );
}
export function Settings({
  snapshot: s,
  userId,
  onClose,
  reload,
}: {
  snapshot: Snapshot;
  userId: string;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [pair, setPair] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [project, setProject] = useState(''),
    [shared, setShared] = useState(false),
    [trust, setTrust] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ownedProjects = s.projects.filter((p) =>
    s.hosts.some((h) => h.id === p.host_id && !h.revoked_at),
  );
  return (
    <Modal title="Workspace settings" onClose={onClose}>
      <section className="settings-section">
        <h3>Connect your Mac</h3>
        <p>Your bot runs Codex on your Mac. Chat stays here, in your browser.</p>
        <ol>
          <li>
            <a href="https://github.com/haoxing-du/porch/releases" target="_blank" rel="noreferrer">
              Get the Mac companion
            </a>
            . Local build instructions are in the repository README.
          </li>
          <li>Open the companion, then enter a pairing code.</li>
        </ol>
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const result = await api<{ token: string }>(
                `/workspaces/${s.workspace.id}/pairings`,
                'POST',
                {},
              );
              setPair(result.token);
            })
          }
        >
          Create pairing code
        </button>
        {pair && (
          <label>
            Pairing code · expires in 5 minutes
            <input readOnly value={pair} onFocus={(e) => e.target.select()} />
          </label>
        )}
        {s.hosts.map((h) => (
          <div className="settings-row" key={h.id}>
            <div>
              <strong>{h.name}</strong>
              <small>{h.revoked_at ? 'Disconnected' : (h.setup_error ?? 'Paired')}</small>
            </div>
            {!h.revoked_at && (
              <button onClick={() => act(() => api(`/hosts/${h.id}`, 'DELETE'))}>Disconnect</button>
            )}
          </div>
        ))}
      </section>
      <section className="settings-section">
        <h3>Your bots</h3>
        {s.bots
          .filter((b) => b.owner_id === userId)
          .map((b) => (
            <div className="settings-row" key={b.id}>
              <div>
                <strong>@{b.handle}</strong>
                <small>
                  {b.host_name} · {b.enabled ? 'Enabled' : 'Disabled'}
                </small>
              </div>
              <button
                onClick={() => act(() => api(`/bots/${b.id}`, 'PATCH', { enabled: !b.enabled }))}
              >
                {b.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api(`/workspaces/${s.workspace.id}/bots`, 'POST', {
                name,
                handle: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                projectId: project,
                projectIds: [project],
                shared,
                trustConfirmed: trust,
              });
              setName('');
              setTrust(false);
            });
          }}
        >
          <label>
            Bot name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Codex"
              maxLength={60}
              required
            />
          </label>
          <label>
            Project
            <select required value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Select a registered project</option>
              {ownedProjects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                  {p.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Shared bot on a communal Mac
          </label>
          <label className="check trust">
            <input
              type="checkbox"
              required
              checked={trust}
              onChange={(e) => setTrust(e.target.checked)}
            />
            I understand that every workspace member can direct this bot and run commands with this
            Mac’s configured access. The project folder is not a security boundary.
          </label>
          <button className="primary" disabled={busy || !ownedProjects.length}>
            Create bot
          </button>
        </form>
      </section>
      {s.workspace.owner_id === userId && (
        <>
          <section className="settings-section">
            <h3>Members</h3>
            {s.members.map((p) => (
              <div className="settings-row" key={p.id}>
                <span>
                  {p.name}
                  {p.id === userId ? ' (you)' : ''}
                </span>
                {p.id !== userId && (
                  <button
                    onClick={() =>
                      act(() => api(`/workspaces/${s.workspace.id}/members/${p.id}`, 'DELETE'))
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </section>
          <section className="settings-section">
            <h3>Invitation links</h3>
            {s.invites.map((i) => (
              <div className="settings-row" key={i.id}>
                <span>
                  {i.revoked_at
                    ? 'Revoked'
                    : `Expires ${new Date(i.expires_at).toLocaleDateString()}`}
                </span>
                {!i.revoked_at && (
                  <button
                    onClick={() =>
                      act(() => api(`/workspaces/${s.workspace.id}/invites/${i.id}`, 'DELETE'))
                    }
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
