/**
 * Local knowledge from the research atlas: documented breezes, convergences,
 * hazards, thermal and soaring spots, take-offs, landings, XC routes and
 * massif labels.
 */
import { isPhoneLayout } from '../viewport';
import type { FlyingSite } from '@brises/shared';
import type { GeoJSONSource } from 'maplibre-gl';
import { addArrowImage, blowingNow, distinctAt, endBearing, liveBreezes, loadSchemaBreezes, mapBreezeDetails, schemaBreezeById, type SchemaBreeze } from '../schema-breezes';
import { banNote, banReason, ffvlSiteAt, FFVL_STATUS_LABEL, hazardAccounts, hazardDuplicates, isSoaring, usableConvergences, loadSkyways, skywayById, ffvlStatus, loadOfficialSites, resolveSpots, setLiveSpots, type Spot, type SpotKind } from '../spots';
import type { ExpressionSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { AtlasFeature, FeatureCategory } from '@brises/shared';
import { windowActivity } from '@brises/model';
import type { AppState, LayerKey } from '../../state/store';
import { CATEGORY_LABELS, CONFIDENCE_LABELS, KIND_LABELS } from '@brises/shared';
import { EXPLAIN } from '../../glossary';
import { BREEZE_COLORS, COLORS } from '../palette';
import { bboxOf, relatedOf, type FeatureDetails, type MapModule, type ModuleContext } from './types';

const GROUPS: Partial<Record<LayerKey, string[]>> = {
  breezes: ['breezes-casing', 'breezes-core', 'breezes-arrows', 'breezes-hit'],
  convergences: ['convergences-glow', 'convergences-line'],
  hazards: ['hazards'],
  thermals: ['thermals', 'thermals-measured'],
  soaring: ['soaring'],
  takeoffs: ['takeoffs'],
  landings: ['landings'],
  routes: ['routes-line'],
  labels: ['massif-labels'],
};

const POINT_CATS = ['takeoffs', 'landings', 'soaring', 'hazards', 'thermals'] as const;
type PointCat = (typeof POINT_CATS)[number];
/** Layer switches that change which item carries a place. */
const SPOT_LAYERS = [...POINT_CATS, 'sitesOfficial'] as const;

const nonEmpty = <T,>(list: T[]) => (list.length ? list : undefined);

/** Short map label: no parenthetical, cut at a dash or comma, at most ~30 characters. */
export function shortLabel(name: string): string {
  let t = name.replace(/\s*\([^)]*\)/g, '').trim();
  if (t.length > 30) t = t.split(/\s[–—-]\s|,|:/)[0].trim();
  return t.length > 32 ? `${t.slice(0, 30).trimEnd()}…` : t || name;
}

export class KnowledgeModule implements MapModule {
  readonly id = 'atlas';
  readonly clickableLayers = ['breezes-hit', 'convergences-line', 'hazards', 'thermals', 'thermals-measured', 'soaring', 'takeoffs', 'landings', 'routes-line'];
  private ctx: ModuleContext | null = null;
  private index = new Map<string, AtlasFeature>();
  /** Point features as first added (labelled), re-sent with their icon decisions. */
  private points = new Map<PointCat, GeoJSON.Feature[]>();
  private officials: FlyingSite[] = [];
  private shown: AppState['layers'] | null = null;

  add(ctx: ModuleContext): void {
    this.ctx = ctx;
    const { map, atlas } = ctx;
    for (const list of Object.values(atlas.features)) for (const f of list) this.index.set(f.properties.id, f);
    for (const cat of Object.keys(atlas.features) as FeatureCategory[]) {
      // Map labels use a short name; the full one stays in the sheet.
      const usable = cat === 'convergences' ? usableConvergences(atlas) : null;
      const features = atlas.features[cat].filter((f) => !usable || usable.has(f.properties.id)).map((f) => ({ ...f, properties: { ...f.properties, label: shortLabel(f.properties.name) } }));
      if ((POINT_CATS as readonly string[]).includes(cat)) this.points.set(cat as PointCat, features as GeoJSON.Feature[]);
      map.addSource(cat, { type: 'geojson', data: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection });
    }
    void loadSchemaBreezes().then(() => this.setBreezes());
    // The routes layer shows the skyways (main corridors), not each route.
    void loadSkyways().then((list) => (map.getSource('routes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: list }));
    void loadOfficialSites().then((list) => {
      this.officials = list;
      if (this.shown) this.resolve(this.shown);
    });
    map.addSource('massif-labels', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: atlas.massifs
          .filter((m) => m.id !== 'alpes-francaises')
          .map((m) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: m.center }, properties: { id: m.id, name: m.shortName } })),
      },
    });

    const kindColor = ['match', ['get', 'kind'], ...Object.entries(BREEZE_COLORS).flat(), '#38bdf8'] as unknown as ExpressionSpecification;
    const active = ['coalesce', ['feature-state', 'active'], 1] as ExpressionSpecification;
    const conf = ['match', ['get', 'confidence'], 'high', 1, 'medium', 0.85, 0.55] as ExpressionSpecification;

    ctx.addLayer(
      {
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // Skyways: wider the more documented routes fly them.
        paint: {
          'line-color': COLORS.route,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['+', 1, ['*', 0.5, ['coalesce', ['get', 'count'], 1]]], 12, ['+', 2, ['*', 1.2, ['coalesce', ['get', 'count'], 1]]]],
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.85,
        },
      },
      'lines',
    );
    // Breezes: one wide arrow per valley (as on the massif pages), lighter so the wind and the spots stay on top.
    addArrowImage(map);
    map.addSource('breeze-heads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Width follows the documented strength; `add` widens the casing (zoom must stay the top-level input).
    const width = (k: number, add = 0) =>
      ['interpolate', ['linear'], ['zoom'], 7, ['+', add, ['*', k, ['+', 1.5, ['*', 0.08, ['get', 'speedKmh']]]]], 12, ['+', add, ['*', k, ['+', 3.5, ['*', 0.22, ['get', 'speedKmh']]]]]] as unknown as ExpressionSpecification;
    ctx.addLayer(
      {
        id: 'breezes-casing',
        type: 'line',
        source: 'breezes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#020617', 'line-width': width(1, 2), 'line-opacity': ['*', 0.35, active] },
      },
      'lines',
    );
    ctx.addLayer(
      {
        id: 'breezes-core',
        type: 'line',
        source: 'breezes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': kindColor, 'line-width': width(1), 'line-opacity': ['*', 0.62, active, conf] },
      },
      'lines',
    );
    ctx.addLayer(
      {
        id: 'breezes-arrows',
        type: 'symbol',
        source: 'breeze-heads',
        layout: {
          'icon-image': 'schema-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.65, 12, 1.15],
          'icon-rotate': ['get', 'rotate'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
        },
        paint: { 'icon-color': kindColor, 'icon-halo-color': '#020617', 'icon-halo-width': 1, 'icon-opacity': ['*', 0.8, active, conf] },
      },
      'lines',
    );
    ctx.addLayer({ id: 'breezes-hit', type: 'line', source: 'breezes', paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 18 } }, 'lines');
    // Convergences: a soft band where pilots find the lift, not a precise line.
    ctx.addLayer(
      {
        id: 'convergences-glow',
        type: 'line',
        source: 'convergences',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COLORS.convergence,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 10, 9, 22, 12, 48],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 6, 8, 9, 16, 12, 34],
          'line-opacity': 0.42,
        },
      },
      'lines',
    );
    // Wide and invisible: the band is clickable anywhere.
    ctx.addLayer(
      {
        id: 'convergences-line',
        type: 'line',
        source: 'convergences',
        paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 30] },
      },
      'lines',
    );

    // A phone shows the same zoom on a screen four times smaller: points come in a little later there.
    const later = isPhoneLayout() ? 0.8 : 0;
    // Only the item that carries its place gets an icon (see map/spots.ts).
    const shownHere = ['!', ['to-boolean', ['get', 'hidden']]] as ExpressionSpecification;
    const point = (id: FeatureCategory, icon: string | ExpressionSpecification, minzoom: number, extra: Partial<NonNullable<SymbolLayerSpecification['layout']>> = {}) =>
      ctx.addLayer(
        {
          id,
          type: 'symbol',
          source: id,
          minzoom: minzoom + later,
          filter: shownHere,
          layout: {
            'icon-image': icon,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 12, 0.95],
            'icon-allow-overlap': true,
            'text-field': ['step', ['zoom'], '', 10.5, ['get', 'label']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-optional': true,
            'text-max-width': 10,
            ...extra,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(15,23,42,0.9)', 'text-halo-width': 1.3 },
        },
        'points',
      );
    // Hundreds of items: they appear as one zooms in, so the overview stays readable.
    const officialIcon = (kind: string) => ['match', ['get', 'status'], 'official', kind, 'forbidden', `${kind}-forbidden`, `${kind}-community`] as ExpressionSpecification;
    point('landings', officialIcon('landing'), 10);
    // Soaring: the icon only, the name on hover.
    point('soaring', 'soaring', 9.5, { 'text-field': '' });
    // Thermals: the icon only, the name on hover.
    point('thermals', 'thermal', 9, { 'text-field': '' });
    // Hotspots known only from GPS tracks (kk7): smaller, unlabelled, from closer in.
    ctx.map.setFilter('thermals', ['all', ['!=', ['get', 'origin'], 'kk7'], shownHere]);
    ctx.addLayer(
      {
        id: 'thermals-measured',
        type: 'symbol',
        source: 'thermals',
        minzoom: 10.5 + later,
        filter: ['all', ['==', ['get', 'origin'], 'kk7'], shownHere],
        layout: { 'icon-image': 'thermal', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10.5, 0.42, 13, 0.7], 'icon-allow-overlap': true, 'symbol-sort-key': ['-', 1, ['get', 'kk7P']] },
        paint: { 'icon-opacity': 0.72 },
      },
      'points',
    );
    point('takeoffs', officialIcon('takeoff'), 9.5);
    // Hazards: the icon only, the name on hover.
    point('hazards', 'hazard', 10, { 'text-field': '' });

    ctx.addLayer(
      {
        id: 'massif-labels',
        type: 'symbol',
        source: 'massif-labels',
        maxzoom: 10,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 9, 15],
          'text-letter-spacing': 0.04,
          'text-max-width': 8,
          'text-padding': 6,
        },
        paint: { 'text-color': '#fff7e0', 'text-halo-color': 'rgba(20,16,8,0.7)', 'text-halo-width': 1.6, 'text-halo-blur': 0.5, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.95, 10, 0] },
      },
      'labels',
    );
  }

  apply(s: AppState, prev: AppState | null): void {
    const map = this.ctx?.map;
    if (!map) return;
    if (!prev || prev.layers !== s.layers)
      for (const [key, ids] of Object.entries(GROUPS) as [LayerKey, string[]][])
        if (!prev || prev.layers[key] !== s.layers[key]) for (const id of ids) map.setLayoutProperty(id, 'visibility', s.layers[key] ? 'visible' : 'none');
    if (!prev || prev.hour !== s.hour) this.updateActivity(s.hour);
    if (!prev || SPOT_LAYERS.some((k) => prev.layers[k] !== s.layers[k])) this.resolve(s.layers);
  }

  /** One icon per place among the shown families (and the official sites when shown). */
  private resolve(layers: AppState['layers']): void {
    this.shown = layers;
    const map = this.ctx?.map;
    if (!map) return;
    const spots: Spot[] = [];
    const dups = hazardDuplicates(this.ctx!.atlas);
    for (const [cat, features] of this.points) {
      if (!layers[cat]) continue;
      for (const f of features) {
        const p = f.properties as AtlasFeature['properties'];
        if (f.geometry.type !== 'Point' || dups.has(p.id) || (cat === 'soaring' && !isSoaring(f as AtlasFeature))) continue;
        const [lon, lat] = f.geometry.coordinates;
        spots.push({ ref: `atlas:${p.id}`, kind: cat === 'thermals' && p.origin === 'kk7' ? 'measured' : cat, lon, lat, name: p.name });
      }
    }
    if (layers.sitesOfficial)
      for (const s of this.officials) {
        const official = ffvlStatus(s) === 'official';
        const kind: SpotKind = s.kind === 'landing' ? (official ? 'ffvl-landing' : 'landings') : official ? 'ffvl-takeoff' : 'takeoffs';
        spots.push({ ref: `sites:ffvl:${s.id}`, kind, lon: s.lon, lat: s.lat, name: s.name });
      }
    const r = resolveSpots(spots);
    setLiveSpots(r, spots);
    for (const [cat, features] of this.points) {
      const data = features.map((f) => {
        const p = f.properties as AtlasFeature['properties'];
        const ref = `atlas:${p.id}`;
        const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : [0, 0];
        const ffvl = cat === 'takeoffs' || cat === 'landings' ? ffvlSiteAt(this.officials, cat === 'takeoffs' ? 'takeoff' : 'landing', lon, lat) : null;
        const status = ffvl ? ffvlStatus(ffvl) : null;
        return { ...f, properties: { ...f.properties, ...(status === 'forbidden' ? { note: banNote(ffvl!) } : {}), hidden: r.hidden.has(ref) || dups.has(p.id) || (cat === 'soaring' && !isSoaring(f as AtlasFeature)), status: status ?? 'unofficial' } };
      });
      (map.getSource(cat) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: data });
    }
  }

  /** The live breezes (one arrow per valley) and their heads; numeric ids for the hourly fade. */
  private breezes: SchemaBreeze[] = [];
  private hour = 15;

  private setBreezes(): void {
    const { map, atlas } = this.ctx!;
    this.breezes = liveBreezes(atlas);
    const lines = this.breezes.map((b, i) => ({ type: 'Feature' as const, id: i, geometry: b.geometry, properties: { ...b.properties, category: 'breezes', label: shortLabel(b.properties.name) } }));
    const heads = this.breezes.map((b, i) => {
      const cs = b.geometry.coordinates;
      return { type: 'Feature' as const, id: i, geometry: { type: 'Point' as const, coordinates: cs[cs.length - 1] }, properties: { kind: b.properties.kind, confidence: b.properties.confidence, rotate: endBearing(cs) - 90 } };
    });
    (map.getSource('breezes') as GeoJSONSource).setData({ type: 'FeatureCollection', features: lines });
    (map.getSource('breeze-heads') as GeoJSONSource).setData({ type: 'FeatureCollection', features: heads });
    this.updateActivity(this.hour);
  }

  /** Breezes fade in and out with the hour; a line repeating another one at that hour stays hidden. */
  private updateActivity(hour: number): void {
    this.hour = hour;
    const { map, atlas } = this.ctx!;
    // Same selection as the massif pages (one arrow per valley), every quarter of an hour.
    const q = Math.round(hour * 4) / 4;
    const shown = new Set(distinctAt(atlas, (p) => blowingNow(p, q), q, `now:${q}`).map((b) => b.properties.id));
    this.breezes.forEach((b, i) => {
      if (!shown.has(b.properties.id)) {
        map.setFeatureState({ source: 'breezes', id: i }, { active: 0 });
        map.setFeatureState({ source: 'breeze-heads', id: i }, { active: 0 });
        return;
      }
      const p = b.properties;
      const w: [number, number] = p.windowStart != null && p.windowEnd != null ? [p.windowStart, p.windowEnd] : [11, 19];
      // Off-hours breezes almost vanish: only what blows now reads on the map.
      const active = 0.05 + 0.95 * windowActivity(hour, w);
      map.setFeatureState({ source: 'breezes', id: i }, { active });
      map.setFeatureState({ source: 'breeze-heads', id: i }, { active });
    });
  }

  /** A conventionné FFVL take-off or landing opens its FFVL page (the sheet shows too). */
  select(id: string): boolean {
    const f = this.index.get(id);
    const cat = f?.properties.category;
    if (!f || (cat !== 'takeoffs' && cat !== 'landings') || f.geometry.type !== 'Point') return false;
    const [lon, lat] = f.geometry.coordinates;
    const site = ffvlSiteAt(this.officials, cat === 'takeoffs' ? 'takeoff' : 'landing', lon, lat);
    if (site?.url && ffvlStatus(site) === 'official') window.open(site.url, '_blank', 'noopener');
    return false;
  }

  /** A skyway's sheet: how many documented routes fly it, each one a link. */
  private describeSkyway(id: string): FeatureDetails | null {
    const s = skywayById(id);
    if (!s) return null;
    const ids = s.properties.routes.split(',');
    const routes = ids.map((r) => this.index.get(r)).filter((f): f is AtlasFeature => !!f);
    const cs = s.geometry.coordinates;
    return {
      ref: `atlas:${id}`,
      category: 'Skyway',
      title: s.properties.name,
      stat: `${s.properties.count} itinéraires documentés passent par ici`,
      paragraphs: [
        'Couloir de cross emprunté par plusieurs itinéraires documentés : leurs balises à moins de 3 km les unes des autres sont regroupées, et un tronçon devient un skyway quand au moins deux itinéraires le volent. Le tracé relie ces balises, ce n’est pas une trace GPS.',
      ],
      related: routes.map((r) => ({ ref: `atlas:${r.properties.id}`, title: r.properties.name, kind: r.properties.details?.Distance ?? 'itinéraire' })),
      bbox: bboxOf(cs),
    };
  }

  get(id: string): AtlasFeature | undefined {
    return this.index.get(id);
  }

  describe(id: string, given: Record<string, unknown> = {}): FeatureDetails | null {
    if (id.startsWith('skyway:')) return this.describeSkyway(id);
    // A map arrow: the atlas breeze it draws, or its own sheet.
    if (id.startsWith('carte:')) {
      const atlasId = given.atlasId ?? schemaBreezeById(id)?.properties.atlasId;
      return atlasId ? this.describe(String(atlasId)) : mapBreezeDetails(id);
    }
    const f = this.index.get(id);
    if (!f) return null;
    const p = f.properties;
    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const badges: FeatureDetails['badges'] = [];
    if (p.kind && KIND_LABELS[p.kind]) badges.push({ label: KIND_LABELS[p.kind], tone: 'info' });
    if (p.confidence) badges.push({ label: CONFIDENCE_LABELS[p.confidence], tone: p.confidence === 'high' ? 'ok' : p.confidence === 'medium' ? 'warn' : 'bad' });
    return {
      ref: `${this.id}:${id}`,
      category: CATEGORY_LABELS[p.category],
      title: p.name,
      badges,
      stat:
        p.category === 'breezes' && p.speedKmh !== undefined
          ? `≈ ${p.speedKmh} km/h${p.windowStart !== undefined ? ` · active ${p.windowStart}h → ${p.windowEnd}h` : ''}`
          : undefined,
      details: p.details ? Object.entries(p.details) : undefined,
      paragraphs: p.description ? p.description.split('\n\n') : undefined,
      sourceIds: p.sources.split(',').filter(Boolean),
      related: nonEmpty([
        ...hazardAccounts(this.ctx!.atlas, id).map((h) => ({ ref: `atlas:${h.properties.id}`, title: h.properties.name, kind: 'même piège, autre source' })),
        ...(relatedOf(`atlas:${id}`) ?? []),
      ]),
      ...(p.category === 'takeoffs' || p.category === 'landings'
        ? (() => {
            const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : [0, 0];
            const site = ffvlSiteAt(this.officials, p.category === 'takeoffs' ? 'takeoff' : 'landing', lon, lat);
            const status = site ? ffvlStatus(site) : null;
            return {
              badges: [{ label: status ? FFVL_STATUS_LABEL[status] : 'Hors liste FFVL', tone: status === 'official' ? 'ok' : status === 'forbidden' ? 'bad' : 'warn' } as const, ...badges],
              ...(status === 'forbidden' ? { warning: `Pratique interdite selon la FFVL : ${banReason(site!)}` } : {}),
              ...(site?.url ? { links: [{ label: 'Fiche du site sur le site de la FFVL', url: site.url }] } : {}),
            };
          })()
        : {}),
      warning: p.coordQuality && p.coordQuality !== 'source' ? 'Position estimée à partir de descriptions : à vérifier sur la fiche FFVL avant usage.' : undefined,
      bbox: bboxOf(coords),
      massifId: p.massif,
      explain: (p.kind && EXPLAIN[p.kind]) || EXPLAIN[p.category],
    };
  }
}
