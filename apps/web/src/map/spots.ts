/**
 * One icon per place. Take-offs, landings, soaring spots, hazards and thermals
 * often sit on the same spot (a take-off, its hazard and its thermal), and the
 * FFVL list and the sources often place the same take-off a few metres apart.
 * Within RADIUS_KM, only the most important item keeps an icon; the others
 * are listed in its sheet ("Au même endroit") and in the massif panel.
 *
 * Priority: official FFVL take-off, other take-off, official FFVL landing,
 * other landing, soaring, hazard, thermal, thermal measured on GPS tracks.
 * A hazard at a take-off is about that take-off: its sheet lists it.
 */
import type { Atlas, AtlasFeature, FlyingSite } from '@brises/shared';
import { distinctLines } from './schema-breezes';

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

// ---------- Official or not: the FFVL sheet decides ----------

/**
 * Status of a site, read from its FFVL sheet (fields « Conventionnement » and « Praticabilité »):
 * - official: « terrain conventionné FFVL » and open to flying (possibly with periods or an authorisation);
 * - forbidden: the FFVL says flying is forbidden there, or the site is temporarily closed;
 * - unofficial: anything else — in the FFVL list without an FFVL convention, or not in the FFVL list at all.
 */
export type FfvlStatus = 'official' | 'unofficial' | 'forbidden';

export function ffvlStatus(site: FlyingSite): FfvlStatus {
  if (site.provider !== 'ffvl') return 'unofficial';
  const practice = (site.details?.['Praticabilité'] ?? '').toLowerCase();
  const convention = (site.details?.['Conventionnement'] ?? '').toLowerCase();
  if (/strictement interdite|temporairement non praticable/.test(practice) || /^pratique interdite/.test(practice)) return 'forbidden';
  return convention.startsWith('terrain conventionné ffvl') ? 'official' : 'unofficial';
}

export const FFVL_STATUS_LABEL: Record<FfvlStatus, string> = {
  official: 'Site officiel FFVL (conventionné)',
  unofficial: 'Non conventionné FFVL',
  forbidden: 'Pratique interdite (FFVL)',
};

// ---------- Shared state: the live map's resolution, read by the sites module and the sheets ----------

let official: Promise<FlyingSite[]> | null = null;

/** The FFVL official sites (baked file, shared with the site directory). */
export function loadOfficialSites(): Promise<FlyingSite[]> {
  official ??= fetch('data/sites-ffvl.json')
    .then((r) => (r.ok ? (r.json() as Promise<FlyingSite[]>) : []))
    .catch(() => []);
  return official;
}

/** Status of the FFVL site of this kind at this place, when the FFVL lists one (a cited site is that site). */
export function ffvlAt(sites: FlyingSite[], kind: 'takeoff' | 'landing', lon: number, lat: number): FfvlStatus | null {
  const s = ffvlSiteAt(sites, kind, lon, lat);
  return s ? ffvlStatus(s) : null;
}

/** The FFVL site of this kind at this place (a cited site is that site), if the FFVL lists one. */
export function ffvlSiteAt(sites: FlyingSite[], kind: 'takeoff' | 'landing', lon: number, lat: number): FlyingSite | null {
  const near = sites
    .filter((s) => (s.kind === 'site' ? 'takeoff' : s.kind) === kind)
    .map((s) => ({ s, d: Math.hypot((s.lon - lon) * KX, (s.lat - lat) * KY) }))
    .filter((x) => x.d < MATCH_KM)
    .sort((a, b) => a.d - b.d)[0];
  return near?.s ?? null;
}

/**
 * Why flying is forbidden at an FFVL site, in a few words, from its sheet: the « Praticabilité »
 * line, the restrictions and the regulation when the sheet has them.
 */
export function banReason(site: FlyingSite): string {
  const d = site.details ?? {};
  const practice = (d['Praticabilité'] ?? '').replace(/^ATTENTION\s*:\s*/i, '').trim();
  const lower = practice.charAt(0).toUpperCase() + practice.slice(1).toLowerCase();
  const more = [d['Restrictions'], d['Réglementation aérienne']].filter(Boolean).join(' · ');
  return [lower, more].filter(Boolean).join(' — ');
}

/** Short hover note of a forbidden site (its first clause). */
export const banNote = (site: FlyingSite) => `Interdit (FFVL) : ${banReason(site).split(/ — |[.;]/)[0].slice(0, 90)}`;

/** A cited take-off is the FFVL one only when they are this close (two take-offs of a slope can be 200 m apart). */
const MATCH_KM = 0.15;

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

// ---------- The same hazard told by several sources ----------

/** Words that say what kind of danger, not which one: left out when comparing subjects. */
const GENERIC = new Set(
  'de du des la le les l d et a au aux en par sur sous vers pour plus avec un une sans ou entre zone zones piege pieges danger risque attention tres est sont qui que vent vents fort forte forts fortes brise brises nord sud ouest decollage deco atterrissage atterro site vol survol interdit interdite turbulent turbulence turbulences rouleaux rotor rotors venturi apres midi matin soir souvent'.split(' '),
);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g)
      ?.filter((w) => w.length > 2 && !GENERIC.has(w)) ?? [],
  );
const subset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
const parenthesis = (s: string) => s.match(/\(([^)]*)\)/)?.[1] ?? null;

/**
 * Hazards that are one: same type of danger, less than 5 km apart, and the subject of one
 * (its name before « : », at least two distinctive words) found whole in the other's name —
 * « ZIT de Grenoble : … » three times. Two zones told apart in brackets (« Verdon, ouest » /
 * « Verdon, centre ») stay two. Keeps the most local account (a sector rather than the
 * whole-Alps page), then the best sourced. Returns duplicate id → kept id.
 */
export function hazardDuplicates(atlas: Atlas): Map<string, string> {
  if (dupCache?.atlas === atlas) return dupCache.map;
  const list = atlas.features.hazards.filter((f) => f.geometry.type === 'Point' && f.properties.origin !== 'kk7');
  const info = list.map((f) => {
    const name = f.properties.name;
    const head = name.includes(':') ? name.slice(0, name.indexOf(':')) : name;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    return { f, head: words(head), all: words(name), paren: parenthesis(name), x: lon * KX, y: lat * KY };
  });
  const rank = (f: AtlasFeature) => (f.properties.massif === 'alpes-francaises' ? 1000 : 0) - (f.properties.sources ?? '').split(',').filter(Boolean).length;
  // Union of the pairs, then each group keeps its best account.
  const parent = list.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < info.length; i++)
    for (let j = i + 1; j < info.length; j++) {
      const [a, b] = [info[i], info[j]];
      if (a.f.properties.kind !== b.f.properties.kind || Math.hypot(a.x - b.x, a.y - b.y) > 5) continue;
      if (a.paren && b.paren && a.paren !== b.paren) continue;
      if ((a.head.size >= 2 && subset(a.head, b.all)) || (b.head.size >= 2 && subset(b.head, a.all))) parent[root(i)] = root(j);
    }
  const groups = new Map<number, AtlasFeature[]>();
  list.forEach((f, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), f]));
  const map = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = [...g].sort((a, b) => rank(a) - rank(b))[0];
    for (const f of g) if (f !== keep) map.set(f.properties.id, keep.properties.id);
  }
  dupCache = { atlas, map };
  return map;
}
let dupCache: { atlas: Atlas; map: Map<string, string> } | null = null;

/** Other accounts of the same hazard, for the sheet of the one shown. */
export function hazardAccounts(atlas: Atlas, id: string): AtlasFeature[] {
  const dups = hazardDuplicates(atlas);
  return atlas.features.hazards.filter((f) => dups.get(f.properties.id) === id);
}

// ---------- Soaring: only what the sources describe as flying the slope in the wind ----------

/**
 * A soaring spot is kept when its text describes flying a slope held up by the wind: « soaring »,
 * « dynamique » (not « thermodynamique »), « vol de pente », « vol de crête », « vent de face ».
 * Evening restitution, thermodynamic flying along cliffs and bare take-off sheets are not soaring.
 */
const SOARING_WORDS = /soaring|soare|(?<!thermo)dynamique|vol de pente|vol de crete|vent de face/;
export function isSoaring(f: AtlasFeature): boolean {
  const t = `${f.properties.name} ${f.properties.description ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return SOARING_WORDS.test(t);
}

// ---------- Skyways: the routes aggregated into their main corridors (scripts/build-skyways.ts) ----------

export interface Skyway {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { id: string; name: string; count: number; routes: string };
}

let skyways: Promise<Skyway[]> | null = null;
let skywayList: Skyway[] = [];
export function loadSkyways(): Promise<Skyway[]> {
  skyways ??= fetch('data/skyways.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ features: Skyway[] }>) : { features: [] }))
    .then((f) => (skywayList = f.features))
    .catch(() => []);
  return skyways;
}
export const skywayById = (id: string) => skywayList.find((s) => s.properties.id === id);

// ---------- Convergences: only the lift pilots describe ----------

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
/** What a pilot uses: a climb, a cloud marking it, a line flown in cross. */
const LIFT = /ascendan|raccroch|cumulus|\bcu\b|plafond|ca monte|enroul|flott|relance|exploit|vario|thermique|porte|ligne de convergence/;
/** What makes it a hazard instead: told as turbulent or dangerous, with no climb to take. */
const DANGER = /turbulen|dangereu|conflit/;
const STRONG_LIFT = /cumulus|exploit|flott|enroul|raccroch|ligne de convergence|zone d'ascendance|source d'ascendance|varios? de|\d ?m\/s|belle confluence/;
/** Inferred from a map arrow or a principle, not from what pilots met. */
const INFERRED = /deduction|deduit|principe|non documente/;

/**
 * A convergence is shown when its sources describe usable lift there (a climb, a cumulus
 * marking it, a line flown in cross), and not when it is an inference (« déduction »,
 * « principe ») or only a warning of turbulence. Overlapping accounts of the same line
 * are drawn once.
 */
export function usableConvergences(atlas: Atlas): Set<string> {
  if (convCache?.atlas === atlas) return convCache.ids;
  const ok = atlas.features.convergences.filter((f) => {
    const p = f.properties;
    const text = plain(`${p.name} ${p.description ?? ''}`);
    if (p.confidence === 'low' || INFERRED.test(plain(JSON.stringify(p.details ?? {})))) return false;
    // Named a conflict of breezes: a warning, whatever else the text says.
    if (!LIFT.test(text) || /conflit/.test(plain(p.name))) return false;
    return !DANGER.test(text) || STRONG_LIFT.test(text);
  });
  const lines = ok.filter((f) => f.geometry.type === 'LineString' && f.geometry.coordinates.length >= 2);
  const ids = new Set([...distinctLines(lines, 3, 0.5), ...ok.filter((f) => !lines.includes(f))].map((f) => f.properties.id));
  convCache = { atlas, ids };
  return ids;
}
let convCache: { atlas: Atlas; ids: Set<string> } | null = null;
