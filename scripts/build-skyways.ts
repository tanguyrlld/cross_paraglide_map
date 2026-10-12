/**
 * Skyways: the documented cross-country routes aggregated into the main corridors.
 *
 * The routes are turnpoint polylines, and many pass by the same take-offs, cols and
 * summits a few hundred metres apart. Turnpoints closer than MERGE_KM become one node
 * (its position: the mean of its turnpoints); each route becomes a chain of nodes, and
 * each leg between two nodes counts the routes that fly it, whichever the way. A leg
 * flown by at least MIN_ROUTES routes is a skyway; the others stay with their route
 * (Cross tab). Consecutive skyway legs through a node with exactly two of them are
 * joined into one line.
 *
 *   npm run data:skyways      (after data:build)
 *
 * Output: public/data/skyways.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Atlas } from '@brises/shared';

const ROOT = process.cwd();
const ATLAS = join(ROOT, 'apps', 'web', 'public', 'data', 'atlas.json');
const OUT = join(ROOT, 'apps', 'web', 'public', 'data', 'skyways.json');
const MERGE_KM = 3;
const MIN_ROUTES = 2;

const KX = 111.32 * Math.cos((45.3 * Math.PI) / 180);
const KY = 110.57;
type LonLat = [number, number];

const atlas = JSON.parse(readFileSync(ATLAS, 'utf8')) as Atlas;
const routes = atlas.features.routes;

// ---------- Nodes: turnpoints within MERGE_KM of each other (single linkage) ----------
const points: { lon: number; lat: number; route: number; at: number }[] = [];
routes.forEach((f, r) => (f.geometry.coordinates as LonLat[]).forEach(([lon, lat], at) => points.push({ lon, lat, route: r, at })));
const parent = points.map((_, i) => i);
const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
const cell = (v: number) => Math.floor(v / MERGE_KM);
const grid = new Map<string, number[]>();
points.forEach((p, i) => {
  const [x, y] = [p.lon * KX, p.lat * KY];
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const j of grid.get(`${cell(x) + a}:${cell(y) + b}`) ?? []) {
        const q = points[j];
        if (Math.hypot(q.lon * KX - x, q.lat * KY - y) < MERGE_KM) parent[root(i)] = root(j);
      }
  const k = `${cell(x)}:${cell(y)}`;
  grid.set(k, [...(grid.get(k) ?? []), i]);
});
const nodeOf = new Map<number, number>();
const nodes: { lon: number; lat: number; n: number }[] = [];
points.forEach((p, i) => {
  const r = root(i);
  if (!nodeOf.has(r)) {
    nodeOf.set(r, nodes.length);
    nodes.push({ lon: 0, lat: 0, n: 0 });
  }
  const node = nodes[nodeOf.get(r)!];
  node.lon += p.lon;
  node.lat += p.lat;
  node.n++;
});
for (const n of nodes) [n.lon, n.lat] = [n.lon / n.n, n.lat / n.n];
const nodeAt = (i: number) => nodeOf.get(root(i))!;

// ---------- Legs: count the routes flying each pair of nodes ----------
const legs = new Map<string, { a: number; b: number; routes: Set<number> }>();
let i = 0;
routes.forEach((f, r) => {
  const chain: number[] = [];
  for (let k = 0; k < f.geometry.coordinates.length; k++) {
    const n = nodeAt(i++);
    if (chain[chain.length - 1] !== n) chain.push(n);
  }
  for (let k = 1; k < chain.length; k++) {
    const [a, b] = [Math.min(chain[k - 1], chain[k]), Math.max(chain[k - 1], chain[k])];
    const key = `${a}-${b}`;
    if (!legs.has(key)) legs.set(key, { a, b, routes: new Set() });
    legs.get(key)!.routes.add(r);
  }
});
const sky = [...legs.values()].filter((l) => l.routes.size >= MIN_ROUTES);

// ---------- Lines: join legs through nodes where the corridor just goes on ----------
const degree = new Map<number, typeof sky>();
for (const l of sky) for (const n of [l.a, l.b]) degree.set(n, [...(degree.get(n) ?? []), l]);
const used = new Set<(typeof sky)[number]>();
const lines: { nodes: number[]; routes: Set<number> }[] = [];
for (const start of sky) {
  if (used.has(start)) continue;
  used.add(start);
  const chain = [start.a, start.b];
  const routesOn = new Set(start.routes);
  // Extend at both ends while the node joins exactly two skyway legs flown by the same number of routes.
  for (const end of ['tail', 'head'] as const) {
    for (;;) {
      const n = end === 'head' ? chain[chain.length - 1] : chain[0];
      const next = (degree.get(n) ?? []).filter((l) => !used.has(l));
      if ((degree.get(n) ?? []).length !== 2 || next.length !== 1 || next[0].routes.size !== start.routes.size) break;
      const l = next[0];
      used.add(l);
      const other = l.a === n ? l.b : l.a;
      if (end === 'head') chain.push(other);
      else chain.unshift(other);
      for (const r of l.routes) routesOn.add(r);
    }
  }
  lines.push({ nodes: chain, routes: routesOn });
}

/** A node's name: the spot the sources name nearest to it (take-off, landing, thermal), if any. */
const spots = (['takeoffs', 'landings', 'thermals', 'soaring'] as const).flatMap((c) =>
  atlas.features[c].filter((f) => f.properties.origin !== 'kk7').map((f) => ({ name: f.properties.name, at: f.geometry.coordinates as LonLat })),
);
function place(n: number): string {
  const { lon, lat } = nodes[n];
  const best = spots.map((s) => ({ s, d: Math.hypot((s.at[0] - lon) * KX, (s.at[1] - lat) * KY) })).sort((a, b) => a.d - b.d)[0];
  if (!best || best.d > 4) return '';
  const short = best.s.name.split(/\s[–—:(]|\s-\s|,/)[0].replace(/^(Décollage|Déco|Atterrissage|Attéro|Thermique|Site)\s+(du|de la|de l'|des|de|d'|à|au)?\s*/i, '').trim();
  return short.length <= 32 ? short : '';
}

const features = lines.map((l, k) => {
  const [from, to] = [place(l.nodes[0]), place(l.nodes[l.nodes.length - 1])];
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: l.nodes.map((n) => [Math.round(nodes[n].lon * 1e5) / 1e5, Math.round(nodes[n].lat * 1e5) / 1e5]) },
    properties: {
      id: `skyway:${k + 1}`,
      name: from && to && from !== to ? `Skyway ${from} → ${to}` : from || to ? `Skyway de ${from || to}` : 'Skyway',
      count: l.routes.size,
      routes: [...l.routes].map((r) => routes[r].properties.id).join(','),
    },
  };
});
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
const legsAll = legs.size;
console.log(`${routes.length} itinéraires, ${points.length} balises → ${nodes.length} nœuds (rayon ${MERGE_KM} km), ${legsAll} tronçons.`);
console.log(`${sky.length} tronçons volés par au moins ${MIN_ROUTES} itinéraires → ${features.length} skyways.`);
const top = [...features].sort((a, b) => b.properties.count - a.properties.count).slice(0, 10);
for (const f of top) console.log(`  ${f.properties.count} itinéraires · ${f.properties.name}`);
