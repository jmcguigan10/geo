import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
await Promise.all(['world.json', 'world-detail.json', 'SOURCES.md', 'AUTONOMY-SOURCES.md'].map(file => stat(path.join(root, 'public/data', file))));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', 'src']) {
  await cp(path.join(root, file), path.join(out, file), { recursive: true });
}
await cp(path.join(root, 'public'), out, { recursive: true });
console.log('Built self-contained static site in dist/');
