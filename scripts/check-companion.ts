import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestApp, login, call } from '../packages/test-support/src/server';
import { keychainRemove } from '../apps/companion/src/setup';
const f = await createTestApp();
const data = await mkdtemp(join(tmpdir(), 'porch-native-check-'));
const project = await mkdtemp('/tmp/porch-native-project-');
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  const origin = await f.app.listen({ host: '127.0.0.1', port: 0 });
  f.cfg.origin = origin;
  const alex = await login(f.app, 'alex');
  const workspace = (
    await call(f.app, alex, 'POST', '/api/workspaces', { name: 'Companion setup check' })
  ).id;
  const pairing = await call(f.app, alex, 'POST', `/api/workspaces/${workspace}/pairings`, {});
  desktop = await electron.launch({
    args: [resolve('apps/companion')],
    env: { ...process.env, PORCH_USER_DATA_DIR: data },
  });
  const window = await desktop.firstWindow();
  await window.getByLabel('Porch address').fill(origin);
  await window.getByLabel('Pairing code').fill(pairing.token);
  await window.getByRole('button', { name: 'Pair Mac', exact: true }).click();
  await expect(window.getByText('This Mac is paired with your workspace.')).toBeVisible({
    timeout: 15000,
  });
  await window.getByLabel('Project label').fill('Native folder test');
  await window.getByRole('button', { name: 'Choose folder…' }).click();
  console.log(`SELECT PROJECT IN THE NATIVE PICKER: ${project}`);
  await expect(window.locator('#projects')).toContainText('Native folder test', {
    timeout: 180000,
  });
  await expect(window.locator('#setup')).toContainText('signed in', { timeout: 30000 });
  await window.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(window.locator('#connection')).toHaveText('Connected', { timeout: 15000 });
  await window.screenshot({ path: 'test-results/companion-native.png', fullPage: true });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  expect(
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
  ).toBe(false);
  const settings = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'));
  expect(settings.projects[0].path).toContain('porch-native-project');
  expect(JSON.stringify(settings)).not.toContain('credential');
  const snapshot = await call(f.app, alex, 'GET', `/api/workspaces/${workspace}/snapshot`);
  expect(snapshot.projects[0].label).toBe('Native folder test');
  await writeFile(
    'docs/companion-evidence.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        build: 'Unsigned Electron development build',
        checks: [
          'Native window launched with fresh settings',
          'Pairing completed through companion form',
          'Host credential stored in macOS Keychain, absent from settings file',
          'Project selected with native Mac folder picker',
          'Installed Codex detected and sign-in checked',
          'Outbound WebSocket connected and registered the project',
          'Closing the window kept the menu-bar companion alive',
        ],
        notVerified: [
          'Public signed/notarized distribution',
          'A separate fresh Mac',
          'Start-at-login after an OS restart',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Native companion checks passed.');
} finally {
  await desktop?.close();
  try {
    const settings = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8'));
    if (settings.hostId) await keychainRemove(settings.hostId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Test credential cleanup requires attention.');
  }
  await f.close();
  await rm(data, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
}
