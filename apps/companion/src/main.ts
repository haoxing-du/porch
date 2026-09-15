import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron';
import { join, basename } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CODEX_VERSION } from '../../../packages/contracts/src/index';
import { CodexAdapter, repairMessage } from '../../../packages/codex-adapter/src/index';
import { Journal, HostRuntime } from './runtime';
import {
  type Settings,
  loadSettings,
  saveSettings,
  serviceOrigin,
  discoverCodex,
  keychainStore,
  keychainRead,
  keychainRemove,
  installCodex,
  canonicalProject,
} from './setup';
if (process.env.PORCH_USER_DATA_DIR) app.setPath('userData', process.env.PORCH_USER_DATA_DIR);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window: BrowserWindow,
    tray: Tray,
    settings: Settings,
    adapter: CodexAdapter | undefined,
    runtime: HostRuntime | undefined,
    connection = 'Not connected',
    setup = 'Checking Codex…',
    quitting = false,
    mutation = false;
  const dataDir = app.getPath('userData'),
    settingsPath = join(dataDir, 'settings.json');
  const notify = () => {
    window?.webContents.send('porch:changed');
    tray?.setToolTip(`Porch · ${connection}`);
  };
  const show = () => {
    window?.show();
    window?.focus();
  };
  async function ensureAdapter() {
    if (adapter) return adapter;
    const found = await discoverCodex(settings.executable, join(dataDir, 'codex', 'codex'));
    if (!found.selected)
      throw new Error(
        found.found.length
          ? `Found ${found.found.map((p) => p.version).join(', ')}. Install Codex ${CODEX_VERSION} or select that executable.`
          : 'Codex was not found. Install it or choose its executable.',
      );
    settings.executable = found.selected.path;
    await saveSettings(settingsPath, settings);
    const next = new CodexAdapter(found.selected.path);
    await next.start();
    next.on('failure', () => {
      setup = 'Codex stopped. Disconnect and reconnect to repair it.';
      notify();
    });
    adapter = next;
    return next;
  }
  async function check() {
    try {
      const account = await (await ensureAdapter()).account();
      setup =
        account.requiresOpenaiAuth && !account.account
          ? 'Sign in to Codex to continue.'
          : `Codex ${CODEX_VERSION} · signed in`;
    } catch (error) {
      setup = repairMessage(error);
      if (error instanceof Error && /Install|not found|Found /.test(error.message))
        setup = error.message;
    }
    notify();
  }
  async function disconnect() {
    if (runtime) await runtime.stop();
    runtime = undefined;
    adapter?.close();
    adapter = undefined;
    connection = 'Disconnected';
    notify();
  }
  async function connect() {
    if (!settings.hostId) throw new Error('Pair this Mac first.');
    if (!settings.projects.length) throw new Error('Choose a project folder first.');
    await disconnect();
    const provider = await ensureAdapter();
    const account = await provider.account();
    if (account.requiresOpenaiAuth && !account.account) throw new Error('Sign in to Codex first.');
    const credential = await keychainRead(settings.hostId);
    runtime = new HostRuntime({
      origin: settings.origin,
      credential,
      hostId: settings.hostId,
      projects: () => settings.projects,
      adapter: provider,
      journal: await Journal.open(join(dataDir, `journal-${settings.hostId}.json`)),
      dataDir,
    });
    runtime.on('status', (status: string) => {
      connection = status;
      notify();
    });
    runtime.on('revoked', () => {
      connection = 'Access revoked. Pair again to reconnect.';
      notify();
    });
    runtime.start();
  }
  async function mutate(fn: () => Promise<unknown>) {
    if (mutation) throw new Error('Another setup step is in progress.');
    mutation = true;
    try {
      return await fn();
    } finally {
      mutation = false;
      notify();
    }
  }
  app.on('second-instance', show);
  app.on('activate', show);
  app
    .whenReady()
    .then(async () => {
      await mkdir(dataDir, { recursive: true });
      settings = await loadSettings(settingsPath);
      window = new BrowserWindow({
        width: 480,
        height: 740,
        minWidth: 420,
        minHeight: 550,
        show: false,
        title: 'Porch Companion',
        backgroundColor: '#f5f6ef',
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (e) => e.preventDefault());
      window.on('close', (e) => {
        if (!quitting) {
          e.preventDefault();
          window.hide();
        }
      });
      tray = new Tray(nativeImage.createEmpty());
      tray.setTitle('✳');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open Porch Companion', click: show },
          { label: 'Open chat', click: () => void shell.openExternal(settings.origin) },
          { label: 'Stop work and disconnect', click: () => void disconnect() },
          { type: 'separator' },
          { label: 'Quit Porch Companion', click: () => app.quit() },
        ]),
      );
      tray.on('click', show);
      const guard = (event: Electron.IpcMainInvokeEvent) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error('Untrusted companion request.');
      };
      ipcMain.handle('porch:state', (event) => {
        guard(event);
        return {
          origin: settings.origin,
          paired: !!settings.hostId,
          projects: settings.projects.map((p) => ({
            localId: p.localId,
            label: p.label,
            path: p.path,
          })),
          startAtLogin: settings.startAtLogin,
          connection,
          setup,
          version: CODEX_VERSION,
          executable: settings.executable,
        };
      });
      ipcMain.handle('porch:pair', (event, value: unknown) => {
        guard(event);
        return mutate(async () => {
          const input = z
            .object({ origin: z.string(), token: z.string().min(30).max(100) })
            .strict()
            .parse(value);
          const origin = serviceOrigin(input.origin);
          if (settings.hostId)
            throw new Error('Forget the current pairing before pairing another workspace.');
          const response = await fetch(`${origin}/api/hosts/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: input.token, name: hostname(), version: '0.1.0' }),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? 'Pairing failed.');
          const pair = z
            .object({
              hostId: z.string().uuid(),
              workspaceId: z.string().uuid(),
              credential: z.string(),
            })
            .parse(result);
          await keychainStore(pair.hostId, pair.credential);
          settings = { ...settings, origin, hostId: pair.hostId, workspaceId: pair.workspaceId };
          await saveSettings(settingsPath, settings);
          connection = 'Paired. Choose a folder, then connect.';
        });
      });
      ipcMain.handle('porch:project', (event, value: unknown) => {
        guard(event);
        return mutate(async () => {
          const input = z
            .object({ label: z.string().trim().min(1).max(80) })
            .strict()
            .parse(value);
          const result = await dialog.showOpenDialog(window, {
            title: 'Choose a project folder',
            properties: ['openDirectory', 'createDirectory'],
          });
          if (result.canceled) return;
          const path = await canonicalProject(result.filePaths[0]);
          if (settings.projects.some((p) => p.path === path))
            throw new Error('This folder is already registered.');
          settings.projects.push({
            localId: randomUUID(),
            label: input.label || basename(path),
            path,
          });
          await saveSettings(settingsPath, settings);
          await runtime?.heartbeat();
        });
      });
      ipcMain.handle('porch:repair-project', (event, value: unknown) => {
        guard(event);
        return mutate(async () => {
          const localId = z.string().uuid().parse(value);
          const project = settings.projects.find((p) => p.localId === localId);
          if (!project) throw new Error('Project not found.');
          const result = await dialog.showOpenDialog(window, {
            title: `Repair ${project.label}`,
            properties: ['openDirectory'],
          });
          if (result.canceled) return;
          const path = await canonicalProject(result.filePaths[0]);
          await disconnect();
          project.path = path;
          await saveSettings(settingsPath, settings);
          connection = 'Project repaired. Click Connect to resume.';
        });
      });
      ipcMain.handle('porch:executable', (event) => {
        guard(event);
        return mutate(async () => {
          const result = await dialog.showOpenDialog(window, {
            title: `Choose the Codex ${CODEX_VERSION} executable`,
            properties: ['openFile', 'showHiddenFiles'],
          });
          if (result.canceled) return;
          await disconnect();
          settings.executable = result.filePaths[0];
          await saveSettings(settingsPath, settings);
          await check();
        });
      });
      ipcMain.handle('porch:install', (event) => {
        guard(event);
        return mutate(async () => {
          await disconnect();
          settings.executable = await installCodex(join(dataDir, 'codex'), (text) => {
            setup = text;
            notify();
          });
          await saveSettings(settingsPath, settings);
          await check();
        });
      });
      ipcMain.handle('porch:signin', (event) => {
        guard(event);
        return mutate(async () => {
          const login = await (await ensureAdapter()).signIn();
          if (!login.authUrl)
            throw new Error(
              'Codex did not return a sign-in link. Select a supported installation.',
            );
          const url = new URL(login.authUrl);
          if (
            url.protocol !== 'https:' ||
            !['auth.openai.com', 'auth.chatgpt.com', 'chatgpt.com'].includes(url.hostname)
          )
            throw new Error(
              'Codex returned an unsupported sign-in URL. Use its supported sign-in flow.',
            );
          await shell.openExternal(url.href);
          setup = 'Finish signing in in your browser, then click Check again.';
        });
      });
      ipcMain.handle('porch:check', (event) => {
        guard(event);
        return mutate(check);
      });
      ipcMain.handle('porch:connect', (event) => {
        guard(event);
        return mutate(connect);
      });
      ipcMain.handle('porch:disconnect', (event) => {
        guard(event);
        return mutate(disconnect);
      });
      ipcMain.handle('porch:forget', (event) => {
        guard(event);
        return mutate(async () => {
          await disconnect();
          if (settings.hostId) await keychainRemove(settings.hostId);
          delete settings.hostId;
          delete settings.workspaceId;
          await saveSettings(settingsPath, settings);
          connection = 'Not paired. Revoke the old Mac in web settings.';
        });
      });
      ipcMain.handle('porch:login-item', (event, value: unknown) => {
        guard(event);
        return mutate(async () => {
          const enabled = z.boolean().parse(value);
          app.setLoginItemSettings({ openAtLogin: enabled });
          settings.startAtLogin = enabled;
          await saveSettings(settingsPath, settings);
        });
      });
      ipcMain.handle('porch:open-chat', (event) => {
        guard(event);
        return shell.openExternal(settings.origin);
      });
      await window.loadFile(join(__dirname, 'index.html'));
      if (!app.getLoginItemSettings().wasOpenedAtLogin) show();
      await check();
      if (settings.hostId && settings.projects.length) {
        try {
          await connect();
        } catch (error) {
          connection = repairMessage(error);
          notify();
        }
      }
    })
    .catch((error) => {
      dialog.showErrorBox(
        'Porch cannot start',
        error instanceof Error ? error.message : 'Unknown startup error.',
      );
      app.exit(1);
    });
  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      quitting = true;
      void disconnect().finally(() => app.quit());
    }
  });
}
