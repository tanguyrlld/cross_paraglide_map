/**
 * The breezes of the massif diagrams: one smooth arrow per valley, drawn from
 * Franck Largeault's « Brises des Alpes » map (scripts/build-schema-breezes.ts
 * bakes it, with the atlas filling the valleys it leaves empty), plus the
 * documented down-slope breezes of the morning and evening, which the map
 * does not draw.
 */
import type { Atlas, AtlasFeature } from '@brises/shared';
import type { Map as MlMap } from 'maplibre-gl';
import type { FeatureDetails } from './modules/types';
import { useEffect, useState } from 'react';

export interface SchemaBreezeProps {
  id: string;
  /** The atlas breeze this line draws (name, hours, sources), when there is one. */
  atlasId: string | null;
  massif: string;
  name: string;
  kind: string;
  speedKmh: number;
  windowStart: number | null;
  windowEnd: number | null;
  confidence: 'high' | 'medium' | 'low';
  sources: string;
  origin: 'carte' | 'atlas' | 'local' | 'night';
  mapLayer?: string;
  mapName?: string | null;
}

export interface SchemaBreeze {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: SchemaBreezeProps;
}

interface SchemaBreezeFile {
  massifs: string[];
  source: { id: string; url: string; author: string };
  features: SchemaBreeze[];
}

let file: SchemaBreezeFile | null = null;
let loading: Promise<SchemaBreezeFile | null> | null = null;
const listeners = new Set<() => void>();

export function loadSchemaBreezes(): Promise<SchemaBreezeFile | null> {
  loading ??= fetch('data/schema-breezes.json')
    .then((r) => (r.ok ? (r.json() as Promise<SchemaBreezeFile>) : null))
    .catch(() => null)
    .then((f) => {
      file = f;
      for (const l of listeners) l();
      return f;
    });
  return loading;
}

export const schemaBreezeById = (id: string): SchemaBreeze | undefined => file?.features.find((f) => f.properties.id === id);

/** The file once loaded (null before, or when missing: the atlas breezes are used then). */
export function useSchemaBreezeFile(): SchemaBreezeFile | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void loadSchemaBreezes();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return file;
}

/** Does an activity window [start, end) (hours, may wrap past midnight) overlap a slot? */
export function activeInSlot(start: number | null | undefined, end: number | null | undefined, [a, b]: [number, number]): boolean {
  if (start == null || end == null) return true;
  if (start <= end) return start < b && end > a;
  return a < end || b > start;
}

/** Hours of a window [start, end) (may wrap past midnight) inside a slot. */
function hoursIn(start: number | null, end: number | null, [a, b]: [number, number]): number {
  if (start == null || end == null) return b - a;
  const part = (s: number, e: number) => Math.max(0, Math.min(e, b) - Math.max(s, a));
  return start <= end ? part(start, end) : part(start, 24) + part(0, end);
}

/** Drawn in a slot when it blows there for a good while (not a breeze fading in its first half-hour). */
const inSlot = (p: SchemaBreezeProps, slot: [number, number]) => hoursIn(p.windowStart, p.windowEnd, slot) >= Math.min(1, (slot[1] - slot[0]) / 2);

const NIGHT_KINDS = new Set(['katabatic', 'downvalley']);
const KX = 111.32 * Math.cos((45.3 * Math.PI) / 180);
const KY = 110.57;

/** An atlas breeze in the shape of the baked ones. */
function fromAtlas(f: AtlasFeature, origin: SchemaBreezeProps['origin']): SchemaBreeze {
  const p = f.properties;
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: f.geometry.coordinates as [number, number][] },
    properties: {
      id: p.id,
      atlasId: p.id,
      massif: p.massif,
      name: p.name,
      kind: p.kind ?? 'valley',
      speedKmh: p.speedKmh ?? 12,
      windowStart: p.windowStart ?? null,
      windowEnd: p.windowEnd ?? null,
      confidence: p.confidence ?? 'medium',
      sources: p.sources ?? '',
      origin,
    },
  };
}

/**
 * Lines that tell the same thing: keeps the first of each in `order` and drops the lines
 * that mostly run along a kept one. One arrow per valley.
 */
export function distinctLines<T extends { geometry: { coordinates: unknown } }>(order: T[], nearKm = 1.5, share = 0.6): T[] {
  const xy = (f: T) => (f.geometry.coordinates as [number, number][]).map(([x, y]) => [x * KX, y * KY] as [number, number]);
  const samples = (pts: [number, number][]) => {
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  };
  const toSegment = ([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const kept: { f: T; pts: [number, number][] }[] = [];
  for (const f of order) {
    const pts = xy(f);
    const s = samples(pts);
    const n = s.filter((p) => kept.some((k) => k.pts.slice(1).some((b, i) => toSegment(p, k.pts[i], b) < nearKm))).length;
    if (n / s.length < share) kept.push({ f, pts });
  }
  return kept.map((k) => k.f);
}

/**
 * The breezes drawn for a massif at a time slot: its own, and its neighbours' within `inBox`
 * (faded on the map). `forced` atlas ids are drawn whatever the dedup says (guided visit).
 */
export function schemaBreezesFor(atlas: Atlas, massifId: string, slot: [number, number], inBox: (coords: [number, number][]) => boolean, forced: Set<string> = new Set()): SchemaBreeze[] {
  const own = (b: SchemaBreeze) => b.properties.massif === massifId;
  const isForced = (b: SchemaBreeze) => !!b.properties.atlasId && forced.has(b.properties.atlasId);
  let drawn: SchemaBreeze[];
  if (!file || massifId === 'alpes-francaises') {
    // The whole-Alps page (and the fallback without the baked file): its own large-scale breezes.
    const pool = atlas.features.breezes.map((f) => fromAtlas(f, NIGHT_KINDS.has(f.properties.kind ?? '') ? 'night' : 'atlas'));
    drawn = distinctLines(pool.filter((b) => own(b) && inSlot(b.properties, slot) && !isForced(b)));
  } else {
    // The same lines as the live map, selected once for the whole Alps (see `distinctAt`): this page shows its part.
    const mid = (slot[0] + slot[1]) / 2;
    drawn = distinctAt(atlas, (p) => inSlot(p, slot), mid, `slot:${slot[0]}-${slot[1]}`).filter((b) => (own(b) || inBox(b.geometry.coordinates)) && !isForced(b));
  }
  // What a visit step points at: its line, from the map when it draws it, from the atlas otherwise.
  const extra = [...forced].flatMap((id) => {
    const fromMap = liveBreezes(atlas).find((b) => b.properties.atlasId === id);
    if (fromMap) return [fromMap];
    const f = atlas.features.breezes.find((x) => x.properties.id === id);
    return f ? [fromAtlas(f, 'atlas')] : [];
  });
  return [...drawn, ...extra];
}

const distinctCache = new Map<string, SchemaBreeze[]>();

/**
 * One arrow per valley for the whole Alps: among the breezes `drawn` keeps, those blowing at
 * `hour` first, then the map's order; a line mostly along a kept one is dropped. Shared by the
 * live map (drawn = blowing now) and the massif pages (drawn = blowing in the slot), so both
 * show the same lines.
 */
export function distinctAt(atlas: Atlas, drawn: (p: SchemaBreezeProps) => boolean, hour: number, key: string): SchemaBreeze[] {
  const k = `${file ? 'f' : 'a'}:${key}`;
  const hit = distinctCache.get(k);
  if (hit) return hit;
  const pool = liveBreezes(atlas).filter((b) => drawn(b.properties));
  const now = (b: SchemaBreeze) => activeInSlot(b.properties.windowStart, b.properties.windowEnd, [hour, hour + 0.01]);
  const order = pool.map((b, i) => ({ b, i })).sort((x, y) => Number(now(y.b)) - Number(now(x.b)) || x.i - y.i).map((x) => x.b);
  const out = distinctLines(order);
  if (distinctCache.size > 64) distinctCache.clear();
  distinctCache.set(k, out);
  return out;
}

/** The live map's rule: drawn when it blows at the hour (more than half of its strength). */
export const blowingNow = (p: SchemaBreezeProps, hour: number) => {
  const w: [number, number] = p.windowStart != null && p.windowEnd != null ? [p.windowStart, p.windowEnd] : [11, 19];
  return activeInSlot(w[0], w[1], [hour, hour + 0.01]);
};

/** Bearing of a line's last stretch (degrees clockwise from north), for its arrowhead. */
export function endBearing(coords: [number, number][]): number {
  const b = coords[coords.length - 1];
  // A stretch long enough that the last smoothing step does not tilt the head.
  let a = coords[coords.length - 2];
  for (let i = coords.length - 2; i >= 0; i--) {
    a = coords[i];
    if (Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY) > 0.3) break;
  }
  return (Math.atan2((b[0] - a[0]) * KX, (b[1] - a[1]) * KY) * 180) / Math.PI;
}

/** Arrowhead drawn as a signed-distance field so it takes each breeze's colour (points east). */
export function addArrowImage(map: MlMap): void {
  if (map.hasImage('schema-arrow')) return;
  const s = 48;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff';
  c.beginPath();
  c.moveTo(s * 0.2, s * 0.18);
  c.lineTo(s * 0.82, s * 0.5);
  c.lineTo(s * 0.2, s * 0.82);
  c.lineTo(s * 0.36, s * 0.5);
  c.closePath();
  c.fill();
  map.addImage('schema-arrow', c.getImageData(0, 0, s, s), { sdf: true, pixelRatio: 2 });
}

/** Sheet of a map arrow no atlas breeze describes (the others open the atlas sheet). */
export function mapBreezeDetails(id: string, massifId?: string): FeatureDetails | null {
  const line = schemaBreezeById(id);
  if (!line) return null;
  const p = line.properties;
  const cs = line.geometry.coordinates;
  const xs = cs.map((c) => c[0]);
  const ys = cs.map((c) => c[1]);
  return {
    ref: `schema:${id}`,
    category: 'breezes',
    title: p.name,
    subtitle: 'Brise montante de la journée',
    paragraphs: [
      `Tracée sur la carte « Brises des Alpes » de Franck Largeault${p.mapLayer ? ` (couche ${p.mapLayer})` : ''}, compilation des cartes de vol libre des parcs naturels, de la carte de Julien Wirtz, de la carte suisse des brises et de récits de pilotes. Aucune autre source de l'atlas ne la décrit en détail.`,
    ],
    sourceIds: ['chablais_giffre_arve:S69'],
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    massifId: massifId ?? p.massif,
  };
}

/**
 * The live map's breezes: the same one-arrow-per-valley set as the massif diagrams (all sectors),
 * plus the documented down-slope breezes of the morning and evening. Without the baked file,
 * the atlas breezes as they are.
 */
let liveCache: { file: SchemaBreezeFile | null; list: SchemaBreeze[] } | null = null;

export function liveBreezes(atlas: Atlas): SchemaBreeze[] {
  if (liveCache && liveCache.file === file) return liveCache.list;
  const list = buildLive(atlas);
  liveCache = { file, list };
  return list;
}

function buildLive(atlas: Atlas): SchemaBreeze[] {
  const night = atlas.features.breezes.filter((f) => NIGHT_KINDS.has(f.properties.kind ?? '')).map((f) => fromAtlas(f, 'night'));
  // A line needs two points to carry an arrow (a few local winds are a single point).
  const drawable = (b: SchemaBreeze) => b.geometry.coordinates.length >= 2;
  if (!file) return atlas.features.breezes.map((f) => fromAtlas(f, 'atlas')).filter(drawable);
  return [...file.features, ...night.filter((b) => b.properties.massif !== 'alpes-francaises')].filter(drawable);
}
