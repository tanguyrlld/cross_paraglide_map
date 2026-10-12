import { useState } from 'react';
import { BREEZE_COLORS, COLORS } from '../map/palette';
import { useApp } from '../state/store';
import { IconChevron } from './icons';
import { useIsMobile } from './mobile';

const SPEED_STOPS: [string, string][] = [
  ['#d1edff', '0'],
  ['#54d4ff', '5'],
  ['#8cfa80', '12'],
  ['#ffdb47', '22'],
  ['#ff782e', '35'],
  ['#f52e73', '50+'],
];

/** The map symbols, drawn like the map icons (map/icons.ts). */
export const Sym = {
  takeoff: (solid: boolean, size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M10 3 L17.5 16 L2.5 16 Z" fill="#16a34a" stroke={solid ? '#fff' : 'none'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  landing: (solid: boolean, size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="7" fill={solid ? '#2563eb' : 'rgba(2,6,23,0.8)'} stroke={solid ? '#fff' : '#60a5fa'} strokeWidth={solid ? 1.4 : 2} />
      <text x="10" y="13.5" textAnchor="middle" fontSize="9" fontWeight="700" fill={solid ? '#fff' : '#93c5fd'}>
        A
      </text>
    </svg>
  ),
  forbidden: (shape: 'takeoff' | 'landing', size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {shape === 'takeoff' ? (
        <path d="M10 3 L17.5 16 L2.5 16 Z" fill="rgba(2,6,23,0.8)" stroke="#f43f5e" strokeWidth="2" strokeLinejoin="round" />
      ) : (
        <circle cx="10" cy="10" r="7" fill="rgba(2,6,23,0.8)" stroke="#f43f5e" strokeWidth="2" />
      )}
      <path d={shape === 'takeoff' ? 'M6.5 13.5 L13.5 7.5' : 'M6 14 L14 6'} stroke="#f43f5e" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  thermal: (size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <defs>
        <radialGradient id="sym-th">
          <stop offset="0" stopColor="#fff7d6" />
          <stop offset="0.5" stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="10" cy="10" r="9" fill="url(#sym-th)" />
      <path d="M10 10 m0.6 0 a0.6 0.6 0 1 1 -1.2 0 a2 2 0 1 1 4 0 a3.6 3.6 0 1 1 -7.2 0 a5.2 5.2 0 1 1 10.4 0" fill="none" stroke="#fff" strokeWidth="1.2" />
    </svg>
  ),
  hazard: (size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path d="M10 2 L18.4 17.2 L1.6 17.2 Z" fill="#f59e0b" stroke="#1f2937" strokeWidth="1.2" strokeLinejoin="round" />
      <text x="10" y="15.4" textAnchor="middle" fontSize="10" fontWeight="800" fill="#1f2937">
        !
      </text>
    </svg>
  ),
  soaring: (size = 16) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="#0d9488" stroke="#fff" strokeWidth="1.2" />
      <path d="M4.5 12.5 Q10 3.5 15.5 10" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  zone: (color: string) => (
    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden>
      <path d="M4 6 H18" stroke={color} strokeWidth="10" strokeLinecap="round" opacity="0.25" />
      <path d="M5 6 H17" stroke={color} strokeWidth="5" strokeLinecap="round" opacity="0.45" />
    </svg>
  ),
  line: (color: string, dashed = false) => (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
      <path d="M1 5 H16" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={dashed ? '3 3' : undefined} />
      <path d="M15 1.5 L21 5 L15 8.5 Z" fill={color} />
    </svg>
  ),
};

/** The spot symbols and what an outline means; shared by both views. */
function SpotsBlock({ sites, thermals, hazards, soaring, landings }: { sites: boolean; thermals: boolean; hazards: boolean; soaring: boolean; landings: boolean }) {
  if (!sites && !thermals && !hazards && !soaring && !landings) return null;
  return (
    <div className="legend-block">
      <h4>Sites et repères</h4>
      <div className="swatches sym">
        {sites && (
          <>
            <span>{Sym.takeoff(true)} déco conventionné FFVL</span>
            <span>{Sym.takeoff(false)} déco non conventionné ou hors liste FFVL</span>
          </>
        )}
        {landings && (
          <>
            <span>{Sym.landing(true)} atterro conventionné FFVL</span>
            <span>{Sym.landing(false)} atterro non conventionné ou hors liste FFVL</span>
          </>
        )}
        {sites && <span>{Sym.forbidden('takeoff')} déco interdit ou fermé (FFVL)</span>}
        {landings && <span>{Sym.forbidden('landing')} atterro interdit ou fermé (FFVL)</span>}
        {thermals && <span>{Sym.thermal()} thermique</span>}
        {hazards && <span>{Sym.hazard()} piège</span>}
        {soaring && <span>{Sym.soaring()} soaring</span>}
      </div>
      <p className="hint">Un symbole par lieu ; survolez-le pour son nom (et la raison d’une interdiction). Un site conventionné FFVL ouvre sa fiche FFVL.</p>
    </div>
  );
}

/** Folded state of the map legend, remembered in this browser. */
function rememberedOpen(): boolean {
  try {
    return localStorage.getItem('brises.legend') !== 'folded';
  } catch {
    return true;
  }
}

/**
 * The legend on the map: what the symbols and lines shown right now mean, in the live map
 * (the families switched on in Calques) and on a massif page (its own switches).
 */
export function MapLegend() {
  const { layers, schemaLayers, schemaMassif, schemaPicking, tourStep } = useApp();
  const [open, setOpen] = useState(rememberedOpen);
  const mobile = useIsMobile();
  if (mobile || tourStep !== null || (schemaPicking && !schemaMassif)) return null;
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('brises.legend', open ? 'folded' : 'open');
    } catch {
      // Not remembered: still applied for this visit.
    }
  };
  const massif = !!schemaMassif;
  return (
    <section className={`legend panel ${open ? '' : 'closed'}`} aria-label="Légende">
      <button className="legend-toggle" onClick={toggle} aria-expanded={open}>
        Légende <IconChevron size={13} className="chev" />
      </button>
      {open && (
        <div className="legend-body">
          {massif ? (
            <>
              <SpotsBlock sites={schemaLayers.takeoffs} landings={schemaLayers.landings} thermals={schemaLayers.thermals} hazards={schemaLayers.hazards} soaring={schemaLayers.takeoffs} />
              {(schemaLayers.breezes || schemaLayers.convergences || schemaLayers.routes) && (
                <div className="legend-block">
                  <h4>Lignes</h4>
                  <div className="swatches sym">
                    {schemaLayers.breezes && (
                      <>
                        <span>{Sym.line(BREEZE_COLORS.valley)} brise montante (journée)</span>
                        <span>{Sym.line(BREEZE_COLORS.downvalley)} brise descendante (matin, soir)</span>
                      </>
                    )}
                    {schemaLayers.convergences && <span>{Sym.zone(COLORS.convergence)} convergence (zone d’ascendance)</span>}
                    {schemaLayers.routes && <span>{Sym.line(COLORS.route, true)} transition de cross</span>}
                  </div>
                  <p className="hint">Estompé : secteur voisin. Épaisseur d’une brise : sa force.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <SpotsBlock sites={layers.sitesOfficial || layers.takeoffs || layers.sitesCommunity} landings={layers.sitesOfficial || layers.landings || layers.sitesCommunity} thermals={layers.thermals} hazards={layers.hazards} soaring={layers.soaring} />
              <LegendBody />
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** What the colours and lines of the live map mean (wind, analysis, breezes). */
export function LegendBody() {
  const { overlay, particleColor, layers } = useApp();
  return (
    <div className="legend-body">
      {layers.particles && (
        <div className="legend-block">
          <h4>{particleColor === 'speed' ? 'Vent simulé (km/h)' : 'Air montant / descendant'}</h4>
          {particleColor === 'speed' ? (
            <div className="ramp">
              {SPEED_STOPS.map(([c, l]) => (
                <span key={l} style={{ background: c }}>
                  {l}
                </span>
              ))}
            </div>
          ) : (
            <div className="ramp">
              <span style={{ background: '#4073ff', color: '#fff' }}>descend</span>
              <span style={{ background: '#dbe6f0' }}>neutre</span>
              <span style={{ background: '#ff8f1f' }}>monte</span>
            </div>
          )}
        </div>
      )}
      {overlay === 'exposure' && (
        <div className="legend-block">
          <h4>Exposition au vent météo</h4>
          <div className="swatches">
            <span>
              <i style={{ background: '#2ad16e' }} /> monte (au vent)
            </span>
            <span>
              <i style={{ background: '#eb4034' }} /> abri, rotors
            </span>
            <span>
              <i style={{ background: '#ffab1f' }} /> venturi
            </span>
          </div>
        </div>
      )}
      {overlay === 'thermal' && (
        <div className="legend-block">
          <h4>Potentiel thermique</h4>
          <div className="ramp">
            <span style={{ background: '#ffe63c' }}>faible</span>
            <span style={{ background: '#ff9a1e' }}>bon</span>
            <span style={{ background: '#ff3c00', color: '#fff' }}>fort</span>
          </div>
        </div>
      )}
      {(overlay === 'convergence' || overlay === 'lift') && (
        <div className="legend-block">
          <h4>{overlay === 'lift' ? 'Ascendances estimées' : 'Convergence'}</h4>
          <div className="ramp">
            <span style={{ background: '#3c78e6', color: '#fff' }}>descend</span>
            <span style={{ background: overlay === 'lift' ? '#9adc3c' : '#d65cff' }}>monte</span>
            <span style={{ background: overlay === 'lift' ? '#ff9a3c' : '#e8b5ff' }}>fort</span>
          </div>
        </div>
      )}
      {overlay === 'speed' && (
        <div className="legend-block">
          <h4>Force du vent</h4>
          <div className="ramp">
            <span style={{ background: '#408cf2', color: '#fff' }}>calme</span>
            <span style={{ background: '#4dd9bf' }}>12</span>
            <span style={{ background: '#ffd94d' }}>25</span>
            <span style={{ background: '#f24d4d', color: '#fff' }}>45</span>
          </div>
        </div>
      )}
      {layers.convergences && (
        <div className="legend-block">
          <h4>Convergences</h4>
          <div className="swatches sym">
            <span>{Sym.zone(COLORS.convergence)} zone d’ascendance (rencontre de brises)</span>
          </div>
        </div>
      )}
      {(layers.breezes || layers.comets) && (
        <div className="legend-block">
          <h4>Brises</h4>
          <div className="swatches">
            <span>
              <i className="line" style={{ background: BREEZE_COLORS.valley }} /> brise montante (journée)
            </span>
            <span>
              <i className="line" style={{ background: BREEZE_COLORS.downvalley }} /> brise descendante (matin, soir)
            </span>
            <span>
              <i className="line dashed" style={{ color: BREEZE_COLORS.valley }} /> déduction
            </span>

          </div>
        </div>
      )}
    </div>
  );
}
