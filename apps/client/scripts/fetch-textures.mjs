// Downloads the CC0 surface photos from Poly Haven and packs them for the 3D map:
//   <key>_d.webp  color with the ambient occlusion baked in
//   <key>_n.webp  R, G = normal (OpenGL), B = roughness
// Needs ImageMagick (`magick`). Run from apps/client: `node scripts/fetch-textures.mjs`.
// The keys and their order are the layers that src/map3d/textures.ts loads.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ASSETS = {
  grass: 'sparse_grass',
  forest: 'forest_ground_04',
  rock: 'rock_face_03',
  dirt: 'brown_mud_dry',
  sand: 'coast_sand_01',
  snow: 'snow_02',
  stone: 'medieval_blocks_03',
  planks: 'weathered_brown_planks',
  plaster: 'white_plaster_02',
  roof: 'roof_09',
  thatch: 'thatch_roof_angled',
  cobble: 'cobblestone_floor_08',
  bark: 'bark_brown_02',
  boulder: 'rock_boulder_dry',
};
const SIZES = [512, 256];
const out = join(import.meta.dirname, '..', 'public', 'assets');
const cache = join(tmpdir(), 'shattered-isles-textures');
mkdirSync(cache, { recursive: true });

async function download(url, file) {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' });

for (const [key, id] of Object.entries(ASSETS)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const src = {};
  for (const [map, name] of [
    ['diff', 'Diffuse'],
    ['nor', 'nor_gl'],
    ['arm', 'arm'],
  ]) {
    const url = files[name]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`${id} has no ${name} at 1k`);
    src[map] = join(cache, `${id}_${map}.jpg`);
    await download(url, src[map]);
  }
  for (const size of SIZES) {
    const dir = join(out, 'tex', String(size));
    mkdirSync(dir, { recursive: true });
    const scale = `${size}x${size}`;
    magick(
      src.diff,
      '(',
      src.arm,
      '-channel',
      'R',
      '-separate',
      ')',
      '-compose',
      'Multiply',
      '-composite',
      '-resize',
      scale,
      '-quality',
      '82',
      join(dir, `${key}_d.webp`),
    );
    magick(
      '(',
      src.nor,
      '-channel',
      'R',
      '-separate',
      ')',
      '(',
      src.nor,
      '-channel',
      'G',
      '-separate',
      ')',
      '(',
      src.arm,
      '-channel',
      'G',
      '-separate',
      ')',
      '-set',
      'colorspace',
      'sRGB',
      '-combine',
      '-resize',
      scale,
      '-define',
      'webp:use-sharp-yuv=1',
      '-quality',
      '90',
      join(dir, `${key}_n.webp`),
    );
  }
  console.log(key, '<-', id);
}

writeFileSync(
  join(out, 'CREDITS.md'),
  `# Asset credits

Surface textures in \`tex/\` come from [Poly Haven](https://polyhaven.com) and are licensed
[CC0](https://polyhaven.com/license). They were resized and repacked by
\`scripts/fetch-textures.mjs\`.

| File prefix | Poly Haven asset |
| --- | --- |
${Object.entries(ASSETS)
  .map(([key, id]) => `| \`${key}\` | [${id}](https://polyhaven.com/a/${id}) |`)
  .join('\n')}
`,
);
