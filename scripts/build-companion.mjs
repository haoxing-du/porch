import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('apps/companion/dist', { recursive: true });
await build({
  entryPoints: ['apps/companion/src/main.ts'],
  outfile: 'apps/companion/dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define: { 'import.meta.url': '"file://unused"' },
});
await build({
  entryPoints: ['apps/companion/src/preload.ts'],
  outfile: 'apps/companion/dist/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});
await copyFile('apps/companion/src/index.html', 'apps/companion/dist/index.html');
await copyFile('apps/companion/src/ui.js', 'apps/companion/dist/ui.js');
await copyFile('apps/companion/src/ui.css', 'apps/companion/dist/ui.css');
