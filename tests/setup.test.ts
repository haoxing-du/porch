import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSettings, settingsSchema, serviceOrigin } from '../apps/companion/src/setup';
it('serializes simultaneous setup saves without a partial settings file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'porch-settings-'));
  try {
    const path = join(root, 'settings.json');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        saveSettings(path, settingsSchema.parse({ origin: `http://localhost:${3000 + i}` })),
      ),
    );
    expect(JSON.parse(await readFile(path, 'utf8')).origin).toBe('http://localhost:3009');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects unsafe remote service origins and accepts local development', () => {
  expect(serviceOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  expect(serviceOrigin('https://porch.example.com')).toBe('https://porch.example.com');
  for (const value of [
    'http://example.com',
    'https://user:pass@example.com',
    'file:///etc/passwd',
    'https://example.com/private',
  ])
    expect(() => serviceOrigin(value)).toThrow();
});
