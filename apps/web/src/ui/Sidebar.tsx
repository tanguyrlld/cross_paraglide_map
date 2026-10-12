import type { Atlas, AtlasMassif, FeatureCategory } from '@brises/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeInSlot } from '../map/modules/schema';
import { schemaBreezesFor, useSchemaBreezeFile } from '../map/schema-breezes';
import type { FeatureDetails } from '../map/modules/types';
import { BREEZE_COLORS, COLORS } from '../map/palette';
import { SCHEMA_PHASES, useApp, useRuntime, type SchemaLayerKey } from '../state/store';
import { getController } from './controller-ref';
import { FeedbackBar, startDraft } from './Feedback';
import { FigureGallery } from './Figures';
import { IconBack, IconChevron, IconPlus, IconSearch, IconTarget } from './icons';
import { goTo, openMassif } from './modes';
import { SheetHandle, useIsMobile } from './mobile';
import { ProbeSheet } from './ProbeCard';
import { RoutesBrowser } from './Routes';
import { RichText, SourceList } from './Sources';

/** Opens a massif: its page here and its schema on the map. */
export const openSchema = (massifId: string) => openMassif(massifId);

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

function openFeature(ref: string) {
  const c = getController();
  const d = c?.describe(ref);
  if (!d) return;
  useRuntime.getState().set({ feature: d });
  c?.flyToBbox(d.bbox);
}

/** What the phenomenon is, in plain words: open for beginners, one tap away for the others. */
function Explain({ text }: { text: string }) {
  const level = useApp((s) => s.level);
  const [open, setOpen] = useState(level === 'decouverte');
  return open ? (
    <p className="explain">{text}</p>
  ) : (
    <button className="link-btn explain-toggle" onClick={() => setOpen(true)}>
      Qu’est-ce que c’est ?
    </button>
  );
}

function FeatureSheet({ f, atlas }: { f: FeatureDetails; atlas: Atlas }) {
  const massif = f.massifId ? atlas.massifs.find((m) => m.id === f.massifId) : undefined;
  const back = () => {
    useRuntime.getState().set({ feature: null });
    if (massif && useApp.getState().schemaMassif !== massif.id) openMassif(massif.id);
  };
  return (
    <article className="sheet">
      <button className="back" onClick={back}>
        <IconBack size={15} /> {massif ? massif.shortName : 'Retour'}
      </button>
      <p className="eyebrow">{f.category}</p>
      <h2>{f.title}</h2>
      {f.badges && (
        <div className="badges">
          {f.badges.map((b) => (
            <span key={b.label} className={`badge ${b.tone ?? ''}`}>
              {b.label}
            </span>
          ))}
        </div>
      )}
      {f.stat && <p className="big-stat">{f.stat}</p>}
      {f.explain && <Explain key={`explain:${f.ref}`} text={f.explain} />}
      {f.details && f.details.length > 0 && (
        <dl className="details">
          {f.details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {f.paragraphs?.map((p, i) => (
        <p key={i} className="desc">
          <RichText text={p} atlas={atlas} order={f.sourceIds} />
        </p>
      ))}
      {f.warning && <p className="note">{f.warning}</p>}
      {f.related && (
        <section className="item-section">
          <h3>Au même endroit</h3>
          <ul className="items">
            {f.related.map((r) => (
              <li key={r.ref}>
                <button onClick={() => openFeature(r.ref)}>
                  <span className="item-name">
                    {r.title}
                    <small>{r.kind}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="sheet-actions">
        <button className="btn ghost small" onClick={() => getController()?.flyToBbox(f.bbox)}>
          <IconTarget size={15} /> Centrer
        </button>
        {f.links?.map((l) => (
          <a key={l.url} className="btn ghost small" href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label}
          </a>
        ))}
      </div>
      {f.ref.startsWith('atlas:') && atlas.features.routes.some((r) => r.properties.id === f.ref.slice(6)) && (
        <button
          className="btn small primary"
          onClick={() => {
            const r = atlas.features.routes.find((x) => x.properties.id === f.ref.slice(6))!;
            useRuntime.getState().set({
              feature: null,
              plan: { points: r.geometry.coordinates as [number, number][], names: (r.properties.details?.Points ?? '').split(' → '), picking: false, title: r.properties.name },
            });
            useApp.getState().set({ browseTab: 'routes', schemaMassif: null, selectedMassif: null, browseOpen: true });
          }}
        >
          Lire tronçon par tronçon
        </button>
      )}
      {f.ref.startsWith('atlas:') && <FigureGallery atlas={atlas} featureId={f.ref.slice(6)} title="Figures d’origine" />}
      {f.sourceIds && <SourceList ids={f.sourceIds} atlas={atlas} />}
      {f.attribution && <p className="muted small" dangerouslySetInnerHTML={{ __html: f.attribution }} />}
      <FeedbackBar key={`feedback:${f.ref}`} targetRef={f.ref} title={f.title} />
    </article>
  );
}

const WIND_SECTORS: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, SO: 225, W: 270, O: 270, NW: 315, NO: 315, Bise: 45, Mistral: 340, Lombarde: 80, Foehn: 180, 'Vent du Sud': 180 };

function windMatches(label: string, from: number, kmh: number): boolean {
  if (kmh < 5) return false;
  const key = Object.keys(WIND_SECTORS)
    .sort((a, b) => b.length - a.length)
    .find((k) => label.trim().startsWith(k));
  if (key === undefined) return false;
  return Math.abs(((WIND_SECTORS[key] - from + 540) % 360) - 180) <= 30;
}

/** Sector summary: the first sentences, the rest one tap away. */
function Summary({ text, atlas, order }: { text: string; atlas: Atlas; order: string[] }) {
  const [open, setOpen] = useState(false);
  const short = text.match(/^(?:[^.!?]+[.!?]+\s*){1,3}/)?.[0]?.trim() ?? text;
  const folded = !open && short.length < text.length - 20;
  return (
    <div className="summary">
      <p>
        <RichText text={folded ? short : text} atlas={atlas} order={order} />
      </p>
      {folded && (
        <button className="link-btn" onClick={() => setOpen(true)}>
          Lire la suite
        </button>
      )}
    </div>
  );
}

const ARROW_KIND: Record<string, string> = {
  valley: 'brise de vallée',
  downvalley: 'brise descendante',
  slope: 'brise de pente',
  'plain-to-mountain': 'plaine → montagne',
  lake: 'brise de lac',
  'pass-transfer': 'transfert par un col',
  regional: 'brise régionale',
  katabatic: 'catabatique',
};

const fmtH = (h: number) => `${Math.floor(h)}h${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : ''}`;

function SchemaItem({ id, color, name, meta, low, source = 'atlas' }: { id: string; color: string; name: string; meta?: string; low?: boolean; source?: 'atlas' | 'schema' }) {
  return (
    <li>
      <button onClick={() => openFeature(`${source}:${id}`)}>
        <span className="dot" style={{ background: color }} />
        <span className="item-name">
          {name}
          {meta && <small>{meta}</small>}
        </span>
        {low && <span className="tag warn">déduction</span>}
      </button>
    </li>
  );
}

function SchemaBlock({ title, children, count }: { title: string; children: React.ReactNode; count: number }) {
  return count ? (
    <section className="item-section">
      <h3>
        {title} <span className="count">{count}</span>
      </h3>
      <ul className="items">{children}</ul>
    </section>
  ) : null;
}

const SCHEMA_LAYERS: { key: SchemaLayerKey; label: string; color: string; shape: 'dot' | 'line' | 'dashed' | 'dotted' }[] = [
  { key: 'thermals', label: 'Thermiques', color: COLORS.thermal, shape: 'dot' },
  { key: 'hazards', label: 'Pièges', color: COLORS.hazard, shape: 'dot' },
  { key: 'takeoffs', label: 'Décos', color: COLORS.takeoff, shape: 'dot' },
  { key: 'landings', label: 'Attéros', color: COLORS.landing, shape: 'dot' },
  { key: 'convergences', label: 'Convergences', color: COLORS.convergence, shape: 'dashed' },
  { key: 'routes', label: 'Transitions', color: COLORS.route, shape: 'dotted' },
];

/** The diagram's legend, which is also its switchboard: the breezes always, the rest on demand. */
function SchemaLayers() {
  const layers = useApp((s) => s.schemaLayers);
  const toggle = (k: SchemaLayerKey) => useApp.getState().set({ schemaLayers: { ...layers, [k]: !layers[k] } });
  return (
    <div className="schema-layers" role="group" aria-label="Sur le schéma">
      <span className="chip static" title="Toujours affichées · bleu : brises montantes de la journée · violet : brises descendantes du matin et du soir · épaisseur = force · survolez une brise pour son nom">
        <i className="sw-line" style={{ background: BREEZE_COLORS.valley }} /> Brises
      </span>
      {SCHEMA_LAYERS.map((l) => (
        <button key={l.key} className={`chip ${layers[l.key] ? 'active' : 'off'}`} aria-pressed={layers[l.key]} onClick={() => toggle(l.key)}>
          <i className={l.shape === 'dot' ? 'sw-dot' : `sw-line ${l.shape}`} style={{ background: l.color }} /> {l.label}
        </button>
      ))}
    </div>
  );
}

/** All-in-one reading of a massif for a typical summer day, in sync with the schematic map. */
function SchemaPanel({ m, atlas }: { m: AtlasMassif; atlas: Atlas }) {
  const { schemaPhase, tourStep, schema3d, schemaWind, synopticFrom, synopticKmh, set } = useApp();
  const slot = SCHEMA_PHASES.find((p) => p.key === schemaPhase)!;
  const feats = useMemo(() => {
    const get = (cat: FeatureCategory) => atlas.features[cat].filter((f) => f.properties.massif === m.id).map((f) => f.properties);
    const [w, s, e, n] = m.bbox;
    // Transitions: cross-country routes of any sector that cross this one.
    const routes = atlas.features.routes
      .filter((f) => f.properties.massif === m.id || f.geometry.coordinates.some((c) => Array.isArray(c) && c[0] >= w && c[0] <= e && c[1] >= s && c[1] <= n))
      .map((f) => f.properties);
    // Breezes of neighbouring sectors that run along or into this one (they shape its day too).
    const pad = 0.05;
    const near = atlas.features.breezes
      .filter((f) => f.properties.massif !== m.id && f.properties.massif !== 'alpes-francaises' && f.geometry.coordinates.some((c) => Array.isArray(c) && c[0] >= w - pad && c[0] <= e + pad && c[1] >= s - pad && c[1] <= n + pad))
      .map((f) => f.properties);
    return { near, breezes: get('breezes'), convergences: get('convergences'), thermals: get('thermals'), hazards: get('hazards'), takeoffs: get('takeoffs'), landings: get('landings'), soaring: get('soaring'), routes };
  }, [atlas, m]);
  // The same arrows as the diagram: one per valley, from the « Brises des Alpes » map where it draws the massif.
  useSchemaBreezeFile(); // re-renders once the map's breezes are in
  // One entry per breeze: two arms of the map drawing the same documented flow are listed once.
  const active = schemaBreezesFor(atlas, m.id, slot.hours, () => false)
    .map((b) => b.properties)
    .filter((b, i, all) => b.massif === m.id && all.findIndex((x) => (x.atlasId ?? x.id) === (b.atlasId ?? b.id)) === i);
  const nearActive = feats.near.filter((b) => activeInSlot(b.windowStart, b.windowEnd, slot.hours));
  // The overview first; the full inventory of the massif on demand.
  const [details, setDetails] = useState(false);
  return (
    <article className="sheet schema-sheet">
      <div className="massif-head">
        <button className="back" onClick={() => goTo('massifs')}>
          <IconBack size={15} /> Massifs
        </button>
        <button className="icon-btn ghost" aria-label="Fermer le massif" title="Revenir à la carte" onClick={() => goTo('carte')}>
          ×
        </button>
      </div>
      <p className="eyebrow">{m.region}</p>
      <h2>{m.shortName}</h2>
      <div className="massif-actions">
        {tourStep === null && (
          <button className="btn small primary" onClick={() => set({ tourStep: 0 })}>
            Présente-moi ce massif
          </button>
        )}
        <div className="seg small" role="radiogroup" aria-label="Relief">
          <button className={schema3d ? 'on' : ''} onClick={() => set({ schema3d: true })} role="radio" aria-checked={schema3d}>
            Relief 3D
          </button>
          <button className={!schema3d ? 'on' : ''} onClick={() => set({ schema3d: false })} role="radio" aria-checked={!schema3d}>
            À plat
          </button>
        </div>
        <button className={`btn small ghost ${schemaWind ? 'on' : ''}`} aria-pressed={schemaWind} onClick={() => set({ schemaWind: !schemaWind })} title="Particules, flux des brises et colonnes thermiques animés sous le schéma">
          Vent animé
        </button>
      </div>
      <p className="muted small schema-hint">Une journée d’été type, au moment choisi :</p>
      <div className="chips phase-chips" role="tablist" aria-label="Moment de la journée">
        {SCHEMA_PHASES.map((p) => (
          <button key={p.key} role="tab" aria-selected={p.key === schemaPhase} className={`chip ${p.key === schemaPhase ? 'active' : ''}`} onClick={() => set({ schemaPhase: p.key })}>
            {p.label}
            <small>
              {' '}
              {p.hours[0]}h–{Math.floor(p.hours[1])}h
            </small>
          </button>
        ))}
      </div>
      <SchemaLayers />
      {m.summary && <Summary text={m.summary} atlas={atlas} order={m.sources} />}
      <SchemaBlock title={`Brises ${slot.label.toLowerCase()}`} count={active.length}>
        {active.map((b) => (
          <SchemaItem
            key={b.id}
            id={b.atlasId ?? b.id}
            source={b.atlasId ? 'atlas' : 'schema'}
            color={b.kind === 'katabatic' || b.kind === 'downvalley' ? BREEZE_COLORS.downvalley : BREEZE_COLORS.valley}
            name={b.name}
            meta={[ARROW_KIND[b.kind], b.speedKmh ? `${b.speedKmh} km/h` : '', b.windowStart != null && b.windowEnd != null ? `${fmtH(b.windowStart)}–${fmtH(b.windowEnd)}` : '', b.origin === 'carte' && !b.atlasId ? 'carte Brises des Alpes' : ''].filter(Boolean).join(' · ')}
            low={b.confidence === 'low'}
          />
        ))}
      </SchemaBlock>
      {!active.length && <p className="muted small">Aucune brise documentée sur ce créneau.</p>}
      <button className={`more-btn ${details ? 'open' : ''}`} onClick={() => setDetails(!details)} aria-expanded={details}>
        {details ? 'Moins de détails' : 'Tout le détail du massif'}
        <small>thermiques, pièges, sites, vent météo, conseils, sources</small>
        <IconChevron size={14} className="chev" />
      </button>
      {details && (
        <>
          <SchemaBlock title="Brises des secteurs voisins" count={nearActive.length}>
            {nearActive.map((b) => (
              <SchemaItem
                key={b.id}
                id={b.id}
                color={BREEZE_COLORS[b.kind ?? ''] ?? BREEZE_COLORS.valley}
                name={b.name}
                meta={[atlas.massifs.find((x) => x.id === b.massif)?.shortName, b.speedKmh ? `${b.speedKmh} km/h` : '', b.details?.Horaires].filter(Boolean).join(' · ')}
                low={b.confidence === 'low'}
              />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Convergences" count={feats.convergences.length}>
            {feats.convergences.map((c) => (
              <SchemaItem key={c.id} id={c.id} color={COLORS.convergence} name={c.name} meta={c.details?.Quand} low={c.confidence === 'low'} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Thermiques connus" count={feats.thermals.length}>
            {feats.thermals.map((t) => (
              <SchemaItem key={t.id} id={t.id} color={COLORS.thermal} name={t.name} meta={[t.details?.Heures, t.details?.Déclencheur].filter(Boolean).join(' · ')} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Pièges et dangers" count={feats.hazards.length}>
            {feats.hazards.map((h) => (
              <SchemaItem key={h.id} id={h.id} color={COLORS.hazard} name={h.name} meta={h.details?.Conditions} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Décollages" count={feats.takeoffs.length}>
            {feats.takeoffs.map((t) => (
              <SchemaItem key={t.id} id={t.id} color={COLORS.takeoff} name={t.name} meta={[t.details?.Orientation, t.details?.Altitude].filter(Boolean).join(' · ')} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Soaring" count={feats.soaring.length}>
            {feats.soaring.map((t) => (
              <SchemaItem key={t.id} id={t.id} color={COLORS.soaring} name={t.name} meta={t.details?.Vents} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Atterrissages" count={feats.landings.length}>
            {feats.landings.map((t) => (
              <SchemaItem key={t.id} id={t.id} color={COLORS.landing} name={t.name} meta={t.details?.Altitude} />
            ))}
          </SchemaBlock>
          <SchemaBlock title="Transitions et itinéraires de cross" count={feats.routes.length}>
            {feats.routes.map((r) => (
              <SchemaItem key={r.id} id={r.id} color={COLORS.route} name={r.name} meta={[r.details?.Distance, r.details?.Points].filter(Boolean).join(' · ')} />
            ))}
          </SchemaBlock>
          {m.synoptic.length > 0 && (
            <section className="item-section">
              <h3>Selon le vent météo</h3>
              <dl className="synoptic">
                {m.synoptic.map((s, i) => (
                  <div key={i} className={windMatches(s.wind, synopticFrom, synopticKmh) ? 'match' : ''}>
                    <dt>{s.wind}</dt>
                    <dd>
                      <RichText text={s.effect} atlas={atlas} order={m.sources} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {m.tips.length > 0 && (
            <section className="item-section">
              <h3>Conseils cross</h3>
              <ul className="tips">
                {m.tips.map((t, i) => (
                  <li key={i}>
                    <RichText text={t} atlas={atlas} order={m.sources} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <FigureGallery atlas={atlas} massif={m.id} />
          <SourceList ids={m.sources} atlas={atlas} limit={8} title="Sources du massif" />
          <p className="note">Schéma de synthèse des sources pour une journée thermique d’été sans vent météo marqué. Il ne remplace ni la météo du jour ni les consignes locales.</p>
          <button className="btn ghost small" onClick={() => startDraft({ kind: 'new', targetTitle: m.shortName })}>
            <IconPlus size={15} /> Signaler un phénomène dans ce massif
          </button>
          <FeedbackBar key={m.id} targetRef={`massif:${m.id}`} title={m.shortName} />
        </>
      )}
    </article>
  );
}

/** The whole-Alps sector: large valley breezes, synoptic regimes, long routes. */
const OVERVIEW = 'alpes-francaises';

function MassifBrowser({ atlas }: { atlas: Atlas }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = norm(q.trim());
    return atlas.regions.map((r) => ({
      region: r,
      massifs: atlas.massifs.filter((m) => m.id !== OVERVIEW && m.region === r && (!needle || norm(`${m.name} ${m.summary}`).includes(needle))),
    }));
  }, [atlas, q]);
  const total = atlas.stats;
  return (
    <div className="browser">
      <label className="search">
        <IconSearch size={16} />
        <input type="search" placeholder="Massif, vallée, site…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un massif" />
      </label>
      <p className="muted small stats-line">
        {total.massifs} secteurs · {total.breezes} brises · {total.convergences} convergences · {total.sources} sources
      </p>
      {!q && atlas.massifs.some((m) => m.id === OVERVIEW) && (
        <button className="overview-card" onClick={() => openMassif(OVERVIEW)}>
          <strong>Commencer par la vue d’ensemble</strong>
          <span>Les grandes brises de vallée, les vents météo et les grands itinéraires : les clés pour lire ensuite chaque massif.</span>
        </button>
      )}
      {groups.map(
        (g) =>
          g.massifs.length > 0 && (
            <section key={g.region} className="region">
              <h3>{g.region}</h3>
              <ul>
                {g.massifs.map((m) => (
                  <li key={m.id} className="massif-row">
                    <button onClick={() => openMassif(m.id)}>
                      <span className="item-name">
                        {m.shortName}
                        <small>{m.name.split(' (')[1]?.replace(/\)$/, '') ?? ''}</small>
                      </span>
                      <span className="mini-counts" title="brises · convergences · pièges">
                        <i style={{ background: BREEZE_COLORS.valley }} />
                        {m.items.breezes.length}
                        <i style={{ background: COLORS.convergence }} />
                        {m.items.convergences.length}
                        <i style={{ background: COLORS.hazard }} />
                        {m.items.hazards.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      <button className="btn ghost small add-global" onClick={() => startDraft({ kind: 'new' })}>
        <IconPlus size={15} /> Signaler un phénomène local
      </button>
    </div>
  );
}

export function Sidebar() {
  const atlas = useRuntime((r) => r.atlas);
  const feature = useRuntime((r) => r.feature);
  const probe = useRuntime((r) => r.probe);
  const probeDetails = useRuntime((r) => r.probeDetails);
  const { selectedMassif, schemaMassif, browseOpen, mobileSheet, browseTab } = useApp();
  const mobile = useIsMobile();
  const massif = atlas?.massifs.find((m) => m.id === selectedMassif);
  const schema = atlas?.massifs.find((m) => m.id === schemaMassif);
  const schemaPicking = useApp((x) => x.schemaPicking);
  const open = mobile ? mobileSheet === 'browse' : browseOpen || schemaPicking || !!feature || !!probe || !!schema || !!massif;
  // A new sheet starts at its top.
  const ref = useRef<HTMLElement>(null);
  const contentKey = feature?.ref ?? (probe ? `probe:${probe.lon},${probe.lat}` : schema ? `schema:${schema.id}` : massif ? `massif:${massif.id}` : `browse:${browseTab}`);
  // (Also when it comes back after a visit: it was hidden, and kept the previous content's scroll.)
  const visiting = useApp((x) => x.tourStep !== null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [contentKey, visiting]);
  return (
    <aside ref={ref} className={`sidebar panel ${open ? '' : 'collapsed'} ${probe && !feature && !probeDetails ? 'fit' : ''}`} aria-label="Massifs et connaissances locales">
      {mobile ? (
        <SheetHandle
          onClose={() => {
            // A detail closes back to the massif page under it; anything else goes back to the map.
            if (feature && schemaMassif) useRuntime.getState().set({ feature: null });
            else goTo('carte');
          }}
        />
      ) : (
        !schema &&
        !probe && (
          <button
            className="icon-btn ghost panel-close"
            aria-label="Fermer le panneau"
            onClick={() => goTo('carte')}
          >
            ×
          </button>
        )
      )}
      {!atlas ? (
        <div className="skeleton">
          <span />
          <span />
          <span />
        </div>
      ) : feature ? (
        <FeatureSheet f={feature} atlas={atlas} />
      ) : probe ? (
        <ProbeSheet key={contentKey} />
      ) : schema ? (
        <SchemaPanel key={schema.id} m={schema} atlas={atlas} />
      ) : massif ? (
        <SchemaPanel key={massif.id} m={massif} atlas={atlas} />
      ) : (
        <>
          <p className="eyebrow">{browseTab === 'routes' ? 'Cross' : 'Massifs'}</p>
          {browseTab === 'routes' ? <RoutesBrowser atlas={atlas} /> : <MassifBrowser atlas={atlas} />}
        </>
      )}
    </aside>
  );
}

