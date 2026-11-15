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

/** How much the heights were stretched when the bundled normal maps were computed (scripts/fetch-textures.mjs). */
const BAKED_RELIEF_EXAGGERATION = 4;

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
  // The bundled normal maps were computed with the heights stretched 4 times
  // (RELIEF_EXAGGERATION in scripts/fetch-textures.mjs). Scaling the tangent components
  // by 1/4 undoes that exactly, so the globe is shaded with the true slopes.
  material.normalScale.setScalar(1 / BAKED_RELIEF_EXAGGERATION);
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

/**
 * Mean colour (linear) of the equirectangular colour map between two latitudes, averaged in
 * linear light. The south-polar close-up takes this as its albedo, so the shaded relief meets
 * the photographic globe without a step in colour or brightness. Null when the image cannot be read.
 */
export function bandColour(texture: Texture | null, latFrom: number, latTo: number): Color | null {
  const image = texture?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!image?.width || !image.height) return null;
  const w = 512, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  const row = (lat: number) => Math.min(h - 1, Math.max(0, Math.round(((90 - lat) / 180) * h)));
  const r0 = Math.min(row(latFrom), row(latTo)), r1 = Math.max(row(latFrom), row(latTo));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, r0, w, r1 - r0 + 1).data;
  } catch {
    return null; // a tainted canvas
  }
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += toLinear(data[i]);
    g += toLinear(data[i + 1]);
    b += toLinear(data[i + 2]);
  }
  return n ? new Color(r / n, g / n, b / n) : null;
}

/** What the globe's background stars are, in words: for the relief chip and getState (rule 1 of the brief: generated detail stays labelled). */
export const BACKGROUND_STARS_NOTE = 'Background stars are decorative: random points, not the real sky.';

/** Decorative background stars: random points on a sphere, not a star catalogue (see BACKGROUND_STARS_NOTE). */
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
