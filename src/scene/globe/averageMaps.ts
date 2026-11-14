// The multi-year average maps (NASA PGDA product 69: sunlight and Earth visibility at the
// poles) as textures for the avg-* overlays. The maps and their loader belong to the
// science-layers module (src/science/polarAverages.ts); this file only turns them into
// textures and passes their own words on to the legend.
//
// These are long-term averages of a model. They are never mixed with the dated geometry:
// they are drawn only as this overlay, with their own legend, source and extent.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, UnsignedByteType } from 'three';
import { MOON_RADIUS_M, type OverlayMode } from '../../core/types';
import type { SurfaceUniforms } from './surfaceShader';

type Quantity = 'illumination' | 'earth-visibility';
type Pole = 'S' | 'N';
type Role = 'wide' | 'detail';

/** What this file uses of src/science/polarAverages.ts. */
interface AverageTexture {
  data: Uint8Array;
  size: number;
  metresPerPx: number;
  halfWidthM: number;
  factor: number;
}
interface AverageMap {
  info: { metresPerPx: number; latCompleteTo: number; latCornersTo: number; processing: string; source: { product: string; url: string; resolutionM: number } };
  texture(maxSize?: number): AverageTexture;
}
interface AverageIndex {
  averagingPeriod: string;
  quantities: Record<Quantity, { label: string; shortLabel: string; unit: string; meaning: string }>;
  caveats: string[];
  citation: string;
  productPage: string;
}
interface AveragesModule {
  loadPolarAverage(quantity: Quantity, pole: Pole, role?: Role): Promise<AverageMap>;
  loadPolarAverageIndex(): Promise<AverageIndex>;
}

// Present once the science-layers module is part of the build; an empty list until then.
const found = import.meta.glob('../../science/polarAverages.ts');

async function averagesModule(): Promise<AveragesModule | null> {
  const load = Object.values(found)[0];
  return load ? ((await load()) as AveragesModule) : null;
}

/** What the legend shows for the map on screen. */
export interface AverageLegend {
  label: string;
  unit: string;
  meaning: string;
  period: string;
  /** e.g. "960 m cells poleward of 65 degrees; 120 m cells poleward of 85 degrees". */
  extent: string;
  processing: string[];
  source: string;
  citation: string;
  caveats: string[];
}

export type AverageState = { state: 'off' } | { state: 'loading' } | { state: 'missing'; reason: string } | { state: 'ready'; legend: AverageLegend };

const QUANTITY: Partial<Record<OverlayMode, Quantity>> = { 'avg-illumination': 'illumination', 'avg-earth-visibility': 'earth-visibility' };
const SLOT = { S: { wide: 'uAvgSouth', detail: 'uAvgSouthDetail' }, N: { wide: 'uAvgNorth', detail: 'uAvgNorthDetail' } } as const;
const HALF = { S: { wide: 'x', detail: 'y' }, N: { wide: 'z', detail: 'w' } } as const;

export class AverageMaps {
  private quantity: Quantity | null = null;
  private token = 0;
  private readonly loaded = new Map<string, DataTexture>();
  private readonly requested = new Set<string>();
  private index: AverageIndex | null = null;
  private infos = new Map<string, AverageMap['info']>();
  private status: AverageState = { state: 'off' };
  /** Called when the state or the legend changes. */
  onChange: (() => void) | null = null;

  constructor(private readonly shared: SurfaceUniforms, private readonly maxTextureSize: number) {}

  get state(): AverageState {
    return this.status;
  }

  /**
   * Call every frame with the overlay in force and the pole the camera is near (if any, and
   * close enough for the fine map to matter). Loads what is missing; returns immediately.
   */
  update(overlay: OverlayMode, nearPole: Pole | null): void {
    const quantity = QUANTITY[overlay] ?? null;
    if (quantity !== this.quantity) {
      this.clear();
      this.quantity = quantity;
      this.setStatus(quantity ? { state: 'loading' } : { state: 'off' });
      if (!quantity) return;
    }
    if (!quantity || this.status.state === 'missing') return;
    this.want(quantity, 'S', 'wide');
    this.want(quantity, 'N', 'wide');
    if (nearPole) this.want(quantity, nearPole, 'detail');
  }

  private want(quantity: Quantity, pole: Pole, role: Role): void {
    const key = `${quantity}/${pole}/${role}`;
    if (this.requested.has(key)) return;
    this.requested.add(key);
    const token = this.token;
    void (async () => {
      try {
        const module = await averagesModule();
        if (!module) throw new Error('the average maps (NASA PGDA product 69) are not part of this build');
        this.index ??= await module.loadPolarAverageIndex();
        const map = await module.loadPolarAverage(quantity, pole, role);
        if (token !== this.token) return; // the overlay changed while this was loading
        const t = map.texture(this.maxTextureSize);
        const texture = new DataTexture(t.data, t.size, t.size, RedFormat, UnsignedByteType);
        texture.magFilter = LinearFilter;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        this.loaded.set(key, texture);
        this.infos.set(key, map.info);
        this.shared[SLOT[pole][role]].value = texture;
        this.shared.uAvgHalf.value[HALF[pole][role]] = t.halfWidthM / MOON_RADIUS_M;
        this.setStatus({ state: 'ready', legend: this.legend(quantity) });
      } catch (err) {
        if (token !== this.token) return;
        // Without the wide maps there is nothing to show; a missing fine map just leaves the wide one.
        if (role === 'wide') this.setStatus({ state: 'missing', reason: `Not available: ${err instanceof Error ? err.message : String(err)}.` });
        else console.warn('The fine average map could not be loaded', err);
      }
    })();
  }

  private legend(quantity: Quantity): AverageLegend {
    const index = this.index!;
    const q = index.quantities[quantity];
    const roles = (['wide', 'detail'] as const)
      .map((role) => {
        const info = this.infos.get(`${quantity}/S/${role}`) ?? this.infos.get(`${quantity}/N/${role}`);
        return info ? { info, text: `${info.metresPerPx} m cells poleward of ${Math.abs(info.latCompleteTo)}° latitude (corners to ${Math.abs(info.latCornersTo)}°)` } : null;
      })
      .filter((r) => r !== null);
    return {
      label: q.label,
      unit: q.unit,
      meaning: q.meaning,
      period: index.averagingPeriod,
      extent: `Both poles only: ${roles.map((r) => r.text).join('; ')}. Nothing nearer the equator.`,
      processing: roles.map((r) => r.info.processing),
      source: `${roles[0]?.info.source.product ?? 'NASA PGDA product 69'} (${index.productPage})`,
      citation: index.citation,
      caveats: index.caveats,
    };
  }

  private setStatus(next: AverageState): void {
    this.status = next;
    this.onChange?.();
  }

  private clear(): void {
    this.token++;
    for (const t of this.loaded.values()) t.dispose();
    this.loaded.clear();
    this.requested.clear();
    this.infos.clear();
    for (const pole of ['S', 'N'] as const) for (const role of ['wide', 'detail'] as const) this.shared[SLOT[pole][role]].value = null;
    this.shared.uAvgHalf.value.set(0, 0, 0, 0);
  }
}
