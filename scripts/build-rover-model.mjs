// Prepares the 3D model drawn for the SIMULATED rovers in the surface view.
//
// Source: "NASA Opportunity Rover" by clgreene86, Sketchfab,
//   https://sketchfab.com/3d-models/nasa-opportunity-rover-448474b302be4035baa2895878d6b29b
// Licence: CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). The author must be credited;
// changes must be stated. Not a NASA product: an artist's model of the Mars rover Opportunity,
// used here as a stand-in shape for invented lunar rovers (docs/DATA_SOURCES.md, section 13).
//
// Changes made here, and nothing else:
//   - the two colour textures are resized from 2048 to 1024 pixels and saved as JPEG;
//   - the two metal/roughness textures are left out (the surface view lights the model with
//     plain diffuse shading, as it does the ground), and the references to them removed;
//   - the geometry (scene.bin) is copied unchanged.
//
// Run with: npm run build-rover-model -- <folder holding the unzipped download>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'opportunity-rover');
const src = process.argv[2];
if (!src) throw new Error('Usage: npm run build-rover-model -- <folder holding scene.gltf, scene.bin, textures/ and license.txt>');

const gltf = JSON.parse(await readFile(join(src, 'scene.gltf'), 'utf8'));
if (gltf.extensionsRequired?.length) throw new Error(`The model needs glTF extensions this script does not handle: ${gltf.extensionsRequired.join(', ')}`);
await mkdir(OUT, { recursive: true });

// Keep only the textures used as base colour, renumbered.
const images = [];
const textures = [];
for (const material of gltf.materials) {
  const pbr = material.pbrMetallicRoughness ?? {};
  delete pbr.metallicRoughnessTexture;
  if (!pbr.baseColorTexture) continue;
  const texture = gltf.textures[pbr.baseColorTexture.index];
  const from = gltf.images[texture.source].uri;
  const name = `${material.name}_baseColor.jpg`;
  await sharp(join(src, from)).resize(1024, 1024).jpeg({ quality: 86, mozjpeg: true }).toFile(join(OUT, name));
  images.push({ uri: name, mimeType: 'image/jpeg' });
  textures.push({ ...texture, source: images.length - 1 });
  pbr.baseColorTexture.index = textures.length - 1;
}
gltf.images = images;
gltf.textures = textures;
gltf.asset.extras = { ...gltf.asset.extras, changes: 'Colour textures resized to 1024 px and saved as JPEG; metal/roughness textures removed. Geometry unchanged. See scripts/build-rover-model.mjs.' };

await writeFile(join(OUT, 'scene.gltf'), JSON.stringify(gltf));
await copyFile(join(src, 'scene.bin'), join(OUT, 'scene.bin'));
const licence = await readFile(join(src, 'license.txt'), 'utf8');
await writeFile(join(OUT, 'LICENSE.txt'), `${licence.trimEnd()}\n\nChanges made for this project: ${gltf.asset.extras.changes}\n`);
console.log(`Wrote ${OUT}: scene.gltf, scene.bin, ${images.map((i) => i.uri).join(', ')}, LICENSE.txt`);
