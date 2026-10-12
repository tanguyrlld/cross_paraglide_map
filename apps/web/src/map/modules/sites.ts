/**
 * Take-offs and landings from external directories (FFVL official list,
 * OpenStreetMap, ParaglidingEarth), loaded for the visible area and merged.
 * Community entries that duplicate an official one (< 250 m) are hidden.
 */
import type { FlyingSite, SiteProvider } from '@brises/shared';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { AppState } from '../../state/store';
import { banNote, banReason, FFVL_STATUS_LABEL, ffvlStatus, liveSpots, onLiveSpots, RADIUS_KM } from '../spots';
import { bboxOf, relatedOf, type FeatureDetails, type MapModule, type ModuleContext } from './types';

const KIND_LABEL = { takeoff: 'Décollage', landing: 'Atterrissage', site: 'Site de vol' } as const;

/** Long facts of an official sheet, shown as paragraphs rather than in the facts table. */
const LONG_FACTS = ['Conditions idéales', 'Dangers', 'Restrictions', 'Réglementation aérienne'];

export class SitesModule implements MapModule {
  readonly id = 'sites';
  readonly clickableLayers = ['sites-takeoff', 'sites-landing'];
  private ctx: ModuleContext | null = null;
  private sites = new Map<string, FlyingSite>();
  private covered = new Map<string, [number, number, number, number][]>();
  private failed = new Set<string>();
  private timer = 0;
  private abort: AbortController | null = null;
  private showOfficial = true;
  private showCommunity = true;

  constructor(private providers: SiteProvider[]) {}

  add(ctx: ModuleContext): void {
    this.ctx = ctx;
    const { map } = ctx;
    map.addSource('ext-sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const icon = (kind: string) => ['match', ['get', 'status'], 'official', kind, 'forbidden', `${kind}-forbidden`, `${kind}-community`] as ExpressionSpecification;
    for (const kind of ['landing', 'takeoff'] as const)
      ctx.addLayer(
        {
          id: `sites-${kind}`,
          type: 'symbol',
          source: 'ext-sites',
          minzoom: 9.5,
          filter: ['all', ['==', ['get', 'kind'], kind === 'takeoff' ? 'takeoff' : 'landing'], ['!', ['get', 'dup']]],
          layout: {
            'icon-image': icon(kind),
            'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 13, 0.85],
            'icon-allow-overlap': true,
            // Names from closer in: the documented climbs and hazards keep their labels first.
            'text-field': ['step', ['zoom'], '', 12.8, ['concat', ['get', 'name'], ['case', ['has', 'orient'], ['concat', '\n', ['get', 'orient']], '']]],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10.5,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
            'text-max-width': 10,
          },
          paint: { 'text-color': '#e2e8f0', 'text-halo-color': 'rgba(15,23,42,0.9)', 'text-halo-width': 1.2 },
        },
        'points',
      );
    map.on('moveend', () => this.schedule());
    // The live map decides which item carries each place (map/spots.ts).
    onLiveSpots(() => this.render());
    this.schedule();
  }

  apply(s: AppState, prev: AppState | null): void {
    if (prev && prev.layers.sitesOfficial === s.layers.sitesOfficial && prev.layers.sitesCommunity === s.layers.sitesCommunity) return;
    this.showOfficial = s.layers.sitesOfficial;
    this.showCommunity = s.layers.sitesCommunity;
    const map = this.ctx?.map;
    const any = this.showOfficial || this.showCommunity;
    if (map) for (const id of this.clickableLayers) map.setLayoutProperty(id, 'visibility', any ? 'visible' : 'none');
    this.render();
    this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.load(), 450);
  }

  private wanted(p: SiteProvider): boolean {
    return p.id === 'ffvl' ? this.showOfficial : this.showCommunity;
  }

  private async load(): Promise<void> {
    const map = this.ctx?.map;
    if (!map) return;
    const zoom = map.getZoom();
    const b = map.getBounds();
    // Round outwards so small pans reuse the previous request.
    const q = (v: number, up: boolean) => (up ? Math.ceil(v * 10) : Math.floor(v * 10)) / 10;
    const bbox: [number, number, number, number] = [q(b.getWest(), false), q(Math.max(b.getSouth(), 43), false), q(b.getEast(), true), q(Math.min(b.getNorth(), 47.5), true)];
    if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 6) return; // too large: wait for a closer view
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const jobs = this.providers
      .filter((p) => this.wanted(p) && zoom >= p.minZoom && !this.failed.has(p.id))
      .filter((p) => !(this.covered.get(p.id) ?? []).some((c) => c[0] <= bbox[0] && c[1] <= bbox[1] && c[2] >= bbox[2] && c[3] >= bbox[3]))
      .map(async (p) => {
        try {
          const list = await p.fetch(bbox, abort.signal);
          for (const site of list) this.sites.set(`${p.id}:${site.id}`, site);
          this.covered.set(p.id, [...(this.covered.get(p.id) ?? []), bbox]);
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          // CORS refusal or outage: stop asking this directory for the session.
          this.failed.add(p.id);
          this.ctx?.notify({ type: 'status', module: this.id, message: `${p.label} indisponible` });
        }
      });
    if (!jobs.length) return;
    await Promise.all(jobs);
    this.render();
    this.ctx?.notify({ type: 'data', module: this.id });
  }

  private render(): void {
    const map = this.ctx?.map;
    const src = map?.getSource('ext-sites') as { setData?: (d: GeoJSON.FeatureCollection) => void } | undefined;
    if (!src?.setData) return;
    // The FFVL list with the « Sites FFVL » switch, the community directories with theirs.
    const list = [...this.sites.entries()].filter(([, s]) => (s.provider === 'ffvl' ? this.showOfficial : this.showCommunity));
    // One icon per place: an official site that lost its place to another item, and any community entry
    // where an item is already drawn, carry no icon.
    const live = liveSpots();
    const shown = live.spots.filter((x) => !live.hidden.has(x.ref));
    const kx = 111.32 * Math.cos((45.3 * Math.PI) / 180);
    const taken = (s: FlyingSite) => shown.some((x) => Math.hypot((x.lon - s.lon) * kx, (x.lat - s.lat) * 110.57) < RADIUS_KM);
    src.setData({
      type: 'FeatureCollection',
      features: list.map(([key, s]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: key,
          kind: s.kind === 'site' ? 'takeoff' : s.kind,
          status: ffvlStatus(s),
          ...(ffvlStatus(s) === 'forbidden' ? { note: banNote(s) } : {}),
          name: s.name,
          ...(s.orientations?.length ? { orient: s.orientations.join(' ') } : {}),
          dup: s.provider === 'ffvl' ? live.hidden.has(`${this.id}:${key}`) : taken(s),
        },
      })),
    });
  }

  /** A conventionné FFVL site opens its FFVL page (the sheet shows too). */
  select(id: string): boolean {
    const s = this.sites.get(id);
    if (s?.provider === 'ffvl' && s.url && ffvlStatus(s) === 'official') window.open(s.url, '_blank', 'noopener');
    return false;
  }

  describe(id: string): FeatureDetails | null {
    const s = this.sites.get(id);
    if (!s) return null;
    const provider = this.providers.find((p) => p.id === s.provider);
    return {
      ref: `${this.id}:${id}`,
      category: KIND_LABEL[s.kind],
      title: s.name,
      badges: [
        { label: s.provider === 'ffvl' ? FFVL_STATUS_LABEL[ffvlStatus(s)] : 'Hors liste FFVL', tone: ffvlStatus(s) === 'official' ? 'ok' : ffvlStatus(s) === 'forbidden' ? 'bad' : 'warn' },
        { label: provider?.label ?? s.provider },
      ],
      details: [
        ...(s.altitude ? ([['Altitude', `${Math.round(s.altitude)} m`]] as [string, string][]) : []),
        ...(s.orientations?.length ? ([['Orientation', s.orientations.join(', ')]] as [string, string][]) : []),
        ...Object.entries(s.details ?? {}).filter(([k]) => !LONG_FACTS.includes(k)),
        ['Coordonnées', `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`],
      ],
      paragraphs: [
        ...(s.description ? [s.description] : []),
        ...LONG_FACTS.filter((k) => s.details?.[k]).map((k) => `${k} : ${s.details![k]}`),
      ],
      links: s.url ? [{ label: s.provider === 'ffvl' ? 'Fiche du site sur le site de la FFVL' : 'Fiche du site', url: s.url }] : undefined,
      warning:
        s.provider !== 'ffvl'
          ? 'Site absent de la liste FFVL (annuaire communautaire) : statut, accès et autorisations à vérifier localement.'
          : ffvlStatus(s) === 'forbidden'
            ? `Pratique interdite selon la FFVL : ${banReason(s)}`
            : ffvlStatus(s) === 'unofficial'
              ? `Selon la FFVL : ${s.details?.['Conventionnement'] ?? 'pas de convention FFVL identifiée'}. Vous y volez sous votre propre responsabilité.`
              : 'Extrait de la fiche FFVL : consultez la fiche complète et les consignes locales avant de voler.',
      attribution: provider?.attribution,
      related: relatedOf(`${this.id}:${id}`),
      bbox: bboxOf([[s.lon, s.lat]]),
    };
  }
}
