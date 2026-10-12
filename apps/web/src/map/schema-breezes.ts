/**
 * The breezes of the massif diagrams: one smooth arrow per valley, drawn from
 * Franck Largeault's « Brises des Alpes » map (scripts/build-schema-breezes.ts
 * bakes it, with the atlas filling the valleys it leaves empty), plus the
 * documented down-slope breezes of the morning and evening, which the map
 * does not draw.
 */
import type { Atlas, AtlasFeature } from '@brises/shared';
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
  const keep = (b: SchemaBreeze) => (own(b) || inBox(b.geometry.coordinates)) && inSlot(b.properties, slot);
  // Without the baked file (or for the whole-Alps page), the atlas breezes as they are.
  const day: SchemaBreeze[] = file && massifId !== 'alpes-francaises' ? file.features : atlas.features.breezes.filter((f) => !NIGHT_KINDS.has(f.properties.kind ?? '')).map((f) => fromAtlas(f, 'atlas'));
  const night = atlas.features.breezes.filter((f) => NIGHT_KINDS.has(f.properties.kind ?? '')).map((f) => fromAtlas(f, 'night'));
  const pool = [...day, ...night].filter((b) => (massifId === 'alpes-francaises' ? own(b) && inSlot(b.properties, slot) : keep(b) && b.properties.massif !== 'alpes-francaises'));
  // In the slot's middle hour first (the evening drainage wins over the fading valley breeze), own sector first.
  const mid = (slot[0] + slot[1]) / 2;
  const rank = (b: SchemaBreeze) => (activeInSlot(b.properties.windowStart, b.properties.windowEnd, [mid, mid + 0.01]) ? 0 : 2) + (own(b) ? 0 : 1);
  const order = pool.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
  const isForced = (b: SchemaBreeze) => !!b.properties.atlasId && forced.has(b.properties.atlasId);
  const drawn = distinctLines(order.filter((b) => !isForced(b)));
  // What a visit step points at: its line, from the map when it draws it, from the atlas otherwise.
  const extra = [...forced].flatMap((id) => {
    const fromPool = pool.find((b) => b.properties.atlasId === id);
    if (fromPool) return [fromPool];
    const f = atlas.features.breezes.find((x) => x.properties.id === id);
    return f ? [fromAtlas(f, 'atlas')] : [];
  });
  return [...drawn, ...extra];
}

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
