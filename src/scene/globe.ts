import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from 'three';

const TEX = `${import.meta.env.BASE_URL}textures/`;

/**
 * The Moon's surface material: equirectangular colour and normal maps. Resolves once the
 * 2K colour map is loaded, then swaps in the normal map and a sharper colour map. The
 * caller patches in the shading and supplies the geometry (scene/globe/reliefGlobe.ts).
 */
export async function createMoonMaterial(renderer: WebGLRenderer): Promise<MeshStandardMaterial> {
  const loader = new TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  const prepColour = (t: Texture) => {
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  };

  const material = new MeshStandardMaterial({
    map: prepColour(await loader.loadAsync(`${TEX}moon_color_2k.jpg`)),
    roughness: 1,
    metalness: 0,
  });

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const capable = renderer.capabilities.maxTextureSize >= 8192 && !coarsePointer;
  const hiRes = capable ? '8k' : '4k';

  // Shading detail: the 4K normal map first, then (on capable devices) the sharper 8K one built from LOLA 64 px/degree data.
  const setNormal = (t: Texture) => {
    t.anisotropy = anisotropy;
    const old = material.normalMap;
    material.normalMap = t;
    material.needsUpdate = !old;
    old?.dispose();
  };
  loader.loadAsync(`${TEX}moon_normal_4k.jpg`)
    .then(setNormal)
    .catch((e) => console.warn('normal map failed to load', e))
    .then(() => (capable ? loader.loadAsync(`${TEX}moon_normal_8k.webp`).then(setNormal) : undefined))
    .catch(() => undefined); // the 8K map is optional
  loader.loadAsync(`${TEX}moon_color_${hiRes}.jpg`).then((t) => {
    const old = material.map;
    material.map = prepColour(t);
    old?.dispose();
  }).catch((e) => console.warn('high-res colour map failed to load', e));

  return material;
}

export function createStars(count = 2500): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new Color();
  for (let i = 0; i < count; i++) {
    // Uniform on a sphere.
    const z = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(a) * 500, z * 500, r * Math.sin(a) * 500], i * 3);
    const b = 0.25 + Math.pow(Math.random(), 3) * 0.75;
    c.setHSL(0.55 + Math.random() * 0.1, 0.25, b);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Points(geo, new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
}
