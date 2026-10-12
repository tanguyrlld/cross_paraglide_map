/**
 * One icon per place. Take-offs, landings, soaring spots, hazards and thermals
 * often sit on the same spot (a take-off, its hazard and its thermal), and the
 * FFVL list and the sources often place the same take-off a few metres apart.
 * Within RADIUS_KM, only the most important item keeps an icon; the others
 * are named on hover and listed in its sheet ("Au même endroit").
 *
 * Priority: official FFVL take-off, other take-off, official FFVL landing,
 * other landing, soaring, hazard, thermal, thermal measured on GPS tracks.
 * A hazard at a take-off is about that take-off: its sheet lists it.
 */
import type { FlyingSite } from '@brises/shared';

export type SpotKind = 'ffvl-takeoff' | 'takeoffs' | 'ffvl-landing' | 'landings' | 'soaring' | 'hazards' | 'thermals' | 'measured';

const PRIORITY: SpotKind[] = ['ffvl-takeoff', 'takeoffs', 'ffvl-landing', 'landings', 'soaring', 'hazards', 'thermals', 'measured'];

export const SPOT_LABEL: Record<SpotKind, string> = {
  'ffvl-takeoff': 'décollage officiel',
  takeoffs: 'décollage',
  'ffvl-landing': 'atterrissage officiel',
  landings: 'atterrissage',
  soaring: 'soaring',
  hazards: 'piège',
  thermals: 'thermique',
  measured: 'thermique mesuré',
};

export const RADIUS_KM = 0.3;

export interface Spot {
  /** Sheet reference: `atlas:<id>` or `sites:ffvl:<id>`. */
  ref: string;
  kind: SpotKind;
  lon: number;
  lat: number;
  name: string;
}

export interface Resolution {
  hidden: Set<string>;
  /** Items without an icon, by the ref of the one that carries the place. */
  also: Map<string, Spot[]>;
}

const KX = 111.32 * Math.cos((45.3 * Math.PI) / 180);
const KY = 110.57;

/** The massif diagram is read from further out: icons closer than this read as one place there. */
export const DIAGRAM_RADIUS_KM = 0.5;

/** Keeps, within `radius`, the most important item; `keep` refs always get their icon. */
export function resolveSpots(spots: Spot[], keep: Set<string> = new Set(), radius = RADIUS_KM): Resolution {
  const cell = (v: number) => Math.floor(v / radius);
  const grid = new Map<string, Spot[]>();
  const kept: Spot[] = [];
  const hidden = new Set<string>();
  const also = new Map<string, Spot[]>();
  const order = [...spots].sort((a, b) => Number(keep.has(b.ref)) - Number(keep.has(a.ref)) || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  for (const s of order) {
    const [x, y] = [s.lon * KX, s.lat * KY];
    let owner: Spot | null = null;
    for (let i = -1; i <= 1 && !owner; i++)
      for (let j = -1; j <= 1 && !owner; j++)
        for (const k of grid.get(`${cell(x) + i}:${cell(y) + j}`) ?? []) {
          if (Math.hypot(k.lon * KX - x, k.lat * KY - y) < radius) {
            owner = k;
            break;
          }
        }
    if (owner && !keep.has(s.ref)) {
      hidden.add(s.ref);
      also.set(owner.ref, [...(also.get(owner.ref) ?? []), s]);
      continue;
    }
    kept.push(s);
    const key = `${cell(x)}:${cell(y)}`;
    grid.set(key, [...(grid.get(key) ?? []), s]);
  }
  return { hidden, also };
}

/** "aussi : piège, thermique" for the hover of the item that carries the place. */
export function alsoText(list: Spot[] | undefined): string {
  if (!list?.length) return '';
  return [...new Set(list.map((s) => SPOT_LABEL[s.kind]))].join(', ');
}

// ---------- Shared state: the live map's resolution, read by the sites module and the sheets ----------

let official: Promise<FlyingSite[]> | null = null;

/** The FFVL official sites (baked file, shared with the site directory). */
export function loadOfficialSites(): Promise<FlyingSite[]> {
  official ??= fetch('data/sites-ffvl.json')
    .then((r) => (r.ok ? (r.json() as Promise<FlyingSite[]>) : []))
    .catch(() => []);
  return official;
}

/** Is there an official FFVL site of this kind at this place? (the icon of a cited site then reads official) */
export function officialAt(sites: FlyingSite[], kind: 'takeoff' | 'landing', lon: number, lat: number): boolean {
  return sites.some((s) => (s.kind === 'site' ? 'takeoff' : s.kind) === kind && Math.hypot((s.lon - lon) * KX, (s.lat - lat) * KY) < RADIUS_KM);
}

let live: Resolution & { spots: Spot[] } = { hidden: new Set(), also: new Map(), spots: [] };
const listeners = new Set<() => void>();

export function setLiveSpots(r: Resolution, spots: Spot[]): void {
  live = { ...r, spots };
  for (const l of listeners) l();
}

export const liveSpots = () => live;

export function onLiveSpots(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The open massif diagram's resolution (null on the live map): it wins while a massif is open. */
let diagram: Resolution | null = null;
export const setDiagramSpots = (r: Resolution | null) => {
  diagram = r;
};

/** Items sharing the place of a sheet's item. */
export function sameSpot(ref: string): Spot[] {
  return (diagram ? diagram.also.get(ref) : live.also.get(ref)) ?? [];
}
