import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  chmod,
  cp,
  mkdtemp,
  rm,
  lstat,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CODEX_VERSION } from '../../../packages/contracts/src/index';
const exec = promisify(execFile);
const localProject = z.object({
  localId: z.string().uuid(),
  label: z.string().min(1).max(80),
  path: z.string().min(1),
});
export const settingsSchema = z.object({
  origin: z.string().url().default('http://localhost:5173'),
  hostId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  executable: z.string().optional(),
  projects: z.array(localProject).default([]),
  startAtLogin: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;
export async function loadSettings(path: string): Promise<Settings> {
  try {
    return settingsSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return settingsSchema.parse({});
    throw new Error('Companion settings are damaged. Restore the settings file before connecting.');
  }
}
const settingsWrites = new Map<string, Promise<void>>();
export async function saveSettings(path: string, settings: Settings) {
  const content = JSON.stringify(settingsSchema.parse(settings));
  const operation = (settingsWrites.get(path) ?? Promise.resolve()).then(async () => {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, path);
  });
  settingsWrites.set(path, operation);
  await operation;
}
export function serviceOrigin(value: string) {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new Error('Enter the service origin only, for example https://porch.example.com.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, or HTTP on this Mac for local development.');
  return url.origin;
}
export async function discoverCodex(selected?: string, bundled?: string) {
  const candidates = [
    selected,
    bundled,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.npm-global/bin/codex'),
    join(homedir(), '.local/bin/codex'),
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    ...(process.env.PATH ?? '')
      .split(':')
      .filter(Boolean)
      .map((p) => join(p, 'codex')),
  ].filter((v): v is string => !!v);
  const found: { path: string; version: string }[] = [];
  for (const path of new Set(candidates)) {
    try {
      const output = await exec(path, ['--version'], { timeout: 5000 });
      found.push({ path, version: output.stdout.trim() });
    } catch {
      /* Candidates that do not run are shown as missing if none succeeds. */
    }
  }
  return {
    selected: found.find(
      (p) => (!selected || p.path === selected) && p.version === `codex-cli ${CODEX_VERSION}`,
    ),
    found,
  };
}
export async function keychainStore(hostId: string, credential: string) {
  z.string().uuid().parse(hostId);
  z.string()
    .regex(/^[A-Za-z0-9_-]{40,100}$/)
    .parse(credential);
  // Pass the secret on stdin, never in the process argument list or logs.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (data) => {
      error += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && !/SecKeychain|error:/i.test(error)) resolve();
      else
        reject(
          new Error(
            'macOS Keychain did not save the host credential. Unlock Keychain and try again.',
          ),
        );
    });
    child.stdin.end(
      `add-generic-password -U -s com.porch.companion.host -a ${hostId} -w ${credential}\n`,
    );
  });
}
export async function keychainRead(hostId: string) {
  z.string().uuid().parse(hostId);
  const result = await exec('/usr/bin/security', [
    'find-generic-password',
    '-s',
    'com.porch.companion.host',
    '-a',
    hostId,
    '-w',
  ]);
  return result.stdout.trim();
}
export async function keychainRemove(hostId: string) {
  z.string().uuid().parse(hostId);
  await exec('/usr/bin/security', [
    'delete-generic-password',
    '-s',
    'com.porch.companion.host',
    '-a',
    hostId,
  ]);
}
export async function installCodex(directory: string, onProgress: (text: string) => void) {
  if (process.platform !== 'darwin') throw new Error('This companion supports macOS.');
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!arch) throw new Error('This Mac architecture is not supported.');
  onProgress(`Downloading Codex ${CODEX_VERSION}…`);
  const metadataResponse = await fetch(
    `https://registry.npmjs.org/@openai/codex/${CODEX_VERSION}-darwin-${arch}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!metadataResponse.ok)
    throw new Error(
      'The pinned Codex download is unavailable. Select an existing executable or retry later.',
    );
  const metadata = z
    .object({
      dist: z.object({
        tarball: z.string().startsWith('https://registry.npmjs.org/@openai/codex/-/'),
        integrity: z.string().startsWith('sha512-'),
      }),
    })
    .parse(await metadataResponse.json());
  const response = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body)
    throw new Error('Codex download failed. Retry the installation.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.length;
    if (size > 200 * 1024 * 1024) throw new Error('Codex download exceeded its size limit.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== metadata.dist.integrity)
    throw new Error('Codex download verification failed. Retry the installation.');
  const temp = await mkdtemp(join(tmpdir(), 'porch-codex-install-'));
  try {
    const archive = join(temp, 'codex.tgz');
    await writeFile(archive, bytes);
    const listing = await exec('/usr/bin/tar', ['-tzf', archive]);
    const targetName = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    const prefix = `package/vendor/${targetName}/`;
    const entries = listing.stdout.split('\n').filter((p) => p.startsWith(prefix));
    const required = [
      'bin/codex',
      'bin/codex-code-mode-host',
      'codex-package.json',
      'codex-path/rg',
      'codex-resources/zsh/bin/zsh',
    ];
    if (entries.length !== required.length || required.some((p) => !entries.includes(prefix + p)))
      throw new Error('Codex archive format changed. Select an executable manually.');
    await exec('/usr/bin/tar', ['-xzf', archive, '-C', temp, ...entries]);
    for (const entry of entries)
      if (!(await lstat(join(temp, entry))).isFile())
        throw new Error('Codex archive contains an unexpected file type.');
    await mkdir(directory, { recursive: true });
    const destination = await mkdtemp(join(directory, `${CODEX_VERSION}-`));
    await cp(join(temp, 'package/vendor', targetName), destination, { recursive: true });
    const executable = join(destination, 'bin/codex');
    await chmod(executable, 0o755);
    const output = await exec(executable, ['--version'], { timeout: 10000 });
    if (output.stdout.trim() !== `codex-cli ${CODEX_VERSION}`)
      throw new Error('The downloaded Codex version is not supported.');
    onProgress('Codex is installed.');
    return executable;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export async function canonicalProject(path: string) {
  const result = await realpath(path);
  if (!(await lstat(result)).isDirectory()) throw new Error('Choose a project folder.');
  return result;
}
