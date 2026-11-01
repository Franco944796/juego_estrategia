// The single-file build is copied to /demo so the playable file lives at a stable path in the repo.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const dir = fileURLToPath(new URL('../../../demo/', import.meta.url));
mkdirSync(dir, { recursive: true });
copyFileSync(from, `${dir}shattered-isles.html`);
console.log(`demo → ${dir}shattered-isles.html`);
