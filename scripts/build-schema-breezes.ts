/**
 * Breezes of the massif diagrams, from Franck Largeault's Google My Maps
 * « Brises des Alpes » (école EPIC, Chambéry), a hand-drawn compilation of the
 * PNR flight maps, the Wirtz map, the Swiss breeze map and pilots' notes.
 *
 * Each map line becomes one smooth arrow (the hand-drawn arrowhead is cut
 * off; the app draws its own). A line is matched to the atlas breeze it
 * describes, which brings its name, hours, strength and sources. When a more
 * local, well-sourced breeze of the atlas says the opposite along the same
 * stretch, the map line is dropped and the local breeze is drawn instead.
 * Lines that repeat a longer one (same valley, same way) are dropped too:
 * one arrow per valley.
 *
 *   npm run data:schema-breezes      (after data:build; reads the KML copy below)
 *
 * Output: public/data/schema-breezes.json, and the list of conflicts on stdout.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Atlas, AtlasFeature } from '@brises/shared';

const ROOT = process.cwd();
const KML = join(ROOT, 'research_notes', 'Seconde passe 2026', 'data', 'brises-des-alpes-largeault.kml');
const ATLAS = join(ROOT, 'apps', 'web', 'public', 'data', 'atlas.json');
const OUT = join(ROOT, 'apps', 'web', 'public', 'data', 'schema-breezes.json');
/** The map in the atlas sources (its KML export was read for the first pass). */
const MAP_SOURCE = 'chablais_giffre_arve:S69';
const OVERVIEW = 'alpes-francaises';

/** Same valley: samples within this distance of the other line. */
const NEAR_KM = 1.2;
/** Share of a line along another one to call them the same stretch. */
const SHARE = 0.5;

type LonLat = [number, number];
type XY = [number, number];

const LAT0 = 45.3;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110.57;
const toXY = ([x, y]: LonLat): XY => [x * KX, y * KY];
const toLonLat = ([x, y]: XY): LonLat => [Math.round((x / KX) * 1e5) / 1e5, Math.round((y / KY) * 1e5) / 1e5];
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const length = (pts: XY[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

// ---------- KML ----------

interface MapLine {
  folder: string;
  name: string;
  pts: XY[];
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function readKml(path: string): MapLine[] {
  const xml = readFileSync(path, 'utf8');
  const out: MapLine[] = [];
  for (const folder of xml.split('<Folder>').slice(1)) {
    const folderName = decode(folder.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? '');
    for (const pm of folder.split('<Placemark>').slice(1)) {
      const coords = pm.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/)?.[1];
      if (!coords) continue;
      const pts = coords
        .trim()
        .split(/\s+/)
        .map((c) => c.split(',').map(Number))
        .map(([x, y]) => toXY([x, y]));
      out.push({ folder: folderName, name: decode(pm.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? ''), pts });
    }
  }
  return out;
}

/** The map draws each arrowhead as a small closed triangle after the tip: cut it off. */
function cutArrowhead(pts: XY[]): XY[] | null {
  const n = pts.length;
  if (n >= 5) {
    const tip = pts[n - 4];
    const sides = [dist(tip, pts[n - 3]), dist(pts[n - 3], pts[n - 2]), dist(pts[n - 2], pts[n - 1])];
    const mean = sides.reduce((a, b) => a + b, 0) / 3;
    // Closed back on the tip, and small next to the line itself.
    if (dist(pts[n - 1], tip) < 0.6 * mean && mean < 0.35 * length(pts.slice(0, n - 3))) return pts.slice(0, n - 3);
  }
  // Dashes and other drawings without a head carry no direction.
  return null;
}

// ---------- Geometry ----------

/** Douglas-Peucker: drops the hand jitter before smoothing. */
function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = toSegment(pts[i], a, b);
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** Chaikin corner cutting, ends kept: a smooth curve through the valley. */
function smooth(pts: XY[], rounds = 3): XY[] {
  let p = pts;
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const q: XY[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function toSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Points every `step` km along a line, each with the local direction (unit vector). */
function samples(pts: XY[], step = 0.4): { p: XY; dir: XY }[] {
  const out: { p: XY; dir: XY }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const d = dist(a, b);
    if (!d) continue;
    const dir: XY = [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) out.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], dir });
  }
  out.push({ p: pts[pts.length - 1], dir: out[out.length - 1]?.dir ?? [0, 0] });
  return out;
}

/** Nearest segment of a line: distance and its direction. */
function nearest(p: XY, pts: XY[]): { d: number; dir: XY } {
  let best = { d: Infinity, dir: [0, 0] as XY };
  for (let i = 1; i < pts.length; i++) {
    const d = toSegment(p, pts[i - 1], pts[i]);
    if (d < best.d) {
      const l = dist(pts[i - 1], pts[i]) || 1;
      best = { d, dir: [(pts[i][0] - pts[i - 1][0]) / l, (pts[i][1] - pts[i - 1][1]) / l] };
    }
  }
  return best;
}

/** How much of `a` runs along `b`, and in which sense (mean cosine of the directions, −1 to 1). */
function along(a: XY[], b: XY[]): { share: number; cos: number } {
  const s = samples(a);
  let n = 0;
  let cos = 0;
  for (const { p, dir } of s) {
    const m = nearest(p, b);
    if (m.d > NEAR_KM) continue;
    n++;
    cos += dir[0] * m.dir[0] + dir[1] * m.dir[1];
  }
  return { share: n / s.length, cos: n ? cos / n : 0 };
}

function inside([x, y]: LonLat, ring: LonLat[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ---------- Build ----------

const atlas = JSON.parse(readFileSync(ATLAS, 'utf8')) as Atlas;
const sectors = atlas.massifs.filter((m) => m.id !== OVERVIEW && m.outline);

/** Sector holding most of the line (null outside the French Alps). */
function sectorOf(pts: XY[]): string | null {
  const votes = new Map<string, number>();
  for (const { p } of samples(pts, 0.5)) {
    const ll = toLonLat(p);
    const m = sectors.find((s) => inside(ll, s.outline!));
    if (m) votes.set(m.id, (votes.get(m.id) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const breezes = atlas.features.breezes.map((f) => ({ f, pts: (f.geometry.coordinates as LonLat[]).map(toXY) }));
const sourcesOf = (f: AtlasFeature) => (f.properties.sources ?? '').split(',').filter(Boolean);
/** Day breezes (the map draws the thermal regime, not the night drainage). */
const daytime = (f: AtlasFeature) => {
  const p = f.properties;
  if (p.kind === 'katabatic' || p.kind === 'downvalley') return false;
  if (p.windowStart === undefined || p.windowEnd === undefined) return true;
  return p.windowStart < 17 && p.windowEnd > 12;
};
/** A local account that can outweigh the map: sector-level, reliable, not taken from the map itself. */
const localAndFirm = (f: AtlasFeature) =>
  f.properties.massif !== OVERVIEW && !sourcesOf(f).includes(MAP_SOURCE) && f.properties.confidence !== 'low' && (sourcesOf(f).length >= 2 || f.properties.confidence === 'high');

interface Out {
  geometry: XY[];
  props: Record<string, unknown>;
  len: number;
}

/** Spots the sources name, to say where an unnamed map arrow goes. */
const spots = (['takeoffs', 'landings', 'thermals', 'soaring'] as const).flatMap((c) =>
  atlas.features[c].filter((f) => f.properties.origin !== 'kk7').map((f) => ({ name: f.properties.name, at: toXY(f.geometry.coordinates as LonLat) })),
);
/** "Atterrissage de Saint-Hugues (pré communal)" → "Saint-Hugues". */
function shortPlace(name: string): string {
  let n = name.split(/\s[–—:(]|\s-\s|,/)[0].trim();
  n = n.replace(/^(Décollage|Déco|Atterrissage|Attéro|Atterro|Thermique|Soaring|Site)\s+(du|de la|de l'|des|de|d'|à|au)?\s*/i, '');
  return n.length > 2 && n.length <= 32 ? n : '';
}
/** A name for an arrow nobody describes: where it climbs to, else where it starts. */
function placeName(pts: XY[], massif: string): string {
  const near = (p: XY) =>
    spots
      .map((s) => ({ s, d: dist(s.at, p) }))
      .filter((x) => x.d < 5)
      .sort((a, b) => a.d - b.d)
      .map((x) => shortPlace(x.s.name))
      .find(Boolean);
  const to = near(pts[pts.length - 1]);
  if (to) return `Brise montante vers ${to}`;
  const from = near(pts[0]);
  return from ? `Brise montante depuis ${from}` : `Brise montante · ${atlas.massifs.find((m) => m.id === massif)?.shortName ?? ''}`.replace(/ · $/, '');
}

const lines = readKml(KML);
const out: Out[] = [];
const conflicts: string[] = [];
const replaced = new Set<string>();
let cut = 0;

lines.forEach((line, i) => {
  const body = cutArrowhead(line.pts);
  if (!body || length(body) < 1) return;
  cut++;
  const massif = sectorOf(body);
  if (!massif) return;
  // Map labels: drop the auto names (« Line 4 ») and the region prefix (« Ecrins - Valbonnais » → « Valbonnais »).
  const label = line.name && !/^(Line|Ligne) \d+$/i.test(line.name.trim())
    ? line.name.replace(/\s+/g, ' ').trim().replace(/^(Alpes du Sud|Ecrins|Écrins|Oisans|Tarantaise|Tarentaise|Serre-Ponçon|Barcelonette|Barcelonnette)\s+-\s+/i, '')
    : '';

  // The atlas breeze this line draws (same stretch, same way), and any firm local one saying the opposite.
  let match: { f: AtlasFeature; score: number } | null = null;
  let contra: { f: AtlasFeature; pts: XY[]; share: number } | null = null;
  for (const b of breezes) {
    const ab = along(body, b.pts);
    const ba = along(b.pts, body);
    const share = Math.max(ab.share, ba.share);
    if (share < SHARE) continue;
    const cos = ab.share >= ba.share ? ab.cos : ba.cos;
    if (cos > 0.3) {
      // Prefer the account the map itself fed, then the closest fit.
      const score = share + (sourcesOf(b.f).includes(MAP_SOURCE) ? 0.5 : 0) + (b.f.properties.massif === massif ? 0.2 : 0);
      if (!match || score > match.score) match = { f: b.f, score };
    } else if (cos < -0.5 && daytime(b.f) && localAndFirm(b.f) && (!contra || share > contra.share)) {
      contra = { f: b.f, pts: b.pts, share };
    }
  }

  if (contra) {
    const p = contra.f.properties;
    conflicts.push(`${massif} · carte « ${label || line.folder + ' #' + (i + 1)} » ↔ ${p.id} (${p.name}) : sens opposé, la source locale est retenue`);
    if (!replaced.has(p.id)) {
      replaced.add(p.id);
      out.push({ geometry: smooth(simplify(contra.pts, 0.08)), len: length(contra.pts), props: { ...props(contra.f), massif: p.massif, origin: 'local' } });
    }
    return;
  }

  const geometry = smooth(simplify(body, 0.08));
  const base = match
    ? props(match.f)
    : {
        atlasId: null,
        name: label && !/^(Est|Ouest|Nord|Sud)\b/i.test(label) ? `Brise · ${label}` : placeName(body, massif),
        kind: 'valley',
        speedKmh: 12,
        windowStart: 11,
        windowEnd: 18.5,
        confidence: 'medium',
        sources: MAP_SOURCE,
      };
  out.push({ geometry, len: length(body), props: { ...base, massif, origin: 'carte', mapLayer: line.folder, mapName: label || null } });
});

function props(f: AtlasFeature) {
  const p = f.properties;
  return { atlasId: p.id, name: p.name, kind: p.kind ?? 'valley', speedKmh: p.speedKmh ?? 12, windowStart: p.windowStart ?? null, windowEnd: p.windowEnd ?? null, confidence: p.confidence ?? 'medium', sources: p.sources ?? '' };
}

// One arrow per valley: a line mostly along a longer kept one, the same way, repeats it.
out.sort((a, b) => b.len - a.len);
const kept: Out[] = [];
let repeats = 0;
for (const o of out) {
  const dup = kept.some((k) => {
    const a = along(o.geometry, k.geometry);
    return a.share >= 0.6 && a.cos > 0.3;
  });
  if (dup) repeats++;
  else kept.push(o);
}

// Sectors the map draws in full keep only its arrows; elsewhere the atlas fills the valleys it leaves empty.
const mapCount = new Map<string, number>();
for (const k of kept) if (k.props.origin === 'carte') mapCount.set(k.props.massif as string, (mapCount.get(k.props.massif as string) ?? 0) + 1);
const dayCount = new Map<string, number>();
for (const b of breezes) if (daytime(b.f)) dayCount.set(b.f.properties.massif, (dayCount.get(b.f.properties.massif) ?? 0) + 1);
const massifs = [...mapCount].filter(([m, n]) => n >= 2 && n >= 0.5 * (dayCount.get(m) ?? 0)).map(([m]) => m).sort();
const rankConf = (f: AtlasFeature) => ({ high: 0, medium: 1, low: 2 })[f.properties.confidence ?? 'medium'] ?? 1;
const fill = breezes
  .filter((b) => daytime(b.f) && b.f.properties.massif !== OVERVIEW && !massifs.includes(b.f.properties.massif) && !replaced.has(b.f.properties.id))
  .sort((a, b) => rankConf(a.f) - rankConf(b.f) || length(b.pts) - length(a.pts));
let filled = 0;
for (const b of fill) {
  const taken = kept.some((k) => along(b.pts, k.geometry).share >= SHARE || along(k.geometry, b.pts).share >= 0.8);
  if (taken) continue;
  kept.push({ geometry: smooth(simplify(b.pts, 0.08)), len: length(b.pts), props: { ...props(b.f), massif: b.f.properties.massif, origin: 'atlas' } });
  filled++;
}
const fc = {
  type: 'FeatureCollection',
  /** Sectors drawn from the map (the others keep the atlas breezes). */
  massifs,
  source: { id: MAP_SOURCE, url: 'https://www.google.com/maps/d/viewer?mid=1LZ-3QtkG48alQEQfushGC6d_bAS9Y7o', author: 'Franck Largeault (école EPIC, Chambéry)' },
  features: kept.map((k, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: k.geometry.map(toLonLat) }, properties: { id: `carte:${i + 1}`, ...k.props } })),
};
writeFileSync(OUT, JSON.stringify(fc));

console.log(`${lines.length} lignes sur la carte, ${cut} flèches lues, ${out.length} dans les secteurs, ${repeats} doublons retirés → ${kept.length} brises.`);
console.log(`Rattachées à une brise de l'atlas : ${kept.filter((k) => k.props.origin === 'carte' && k.props.atlasId).length} ; sans équivalent : ${kept.filter((k) => !k.props.atlasId).length}.`);
console.log(`Secteurs tracés par la carte seule (${massifs.length}) : ${massifs.join(', ')}`);
console.log(`Vallées complétées par l'atlas ailleurs : ${filled}.`);
console.log(`\nContradictions (${conflicts.length}) :`);
for (const c of conflicts) console.log(`  - ${c}`);
