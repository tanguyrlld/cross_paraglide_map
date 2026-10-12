import { BREEZE_COLORS, COLORS } from '../map/palette';
import { useApp } from '../state/store';
import { KIND_LABELS } from './format';

const SPEED_STOPS: [string, string][] = [
  ['#d1edff', '0'],
  ['#54d4ff', '5'],
  ['#8cfa80', '12'],
  ['#ffdb47', '22'],
  ['#ff782e', '35'],
  ['#f52e73', '50+'],
];

/** The site and spot symbols, drawn like the map icons. */
const Sym = {
  takeoff: (solid: boolean) => (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 3 L17.5 16 L2.5 16 Z" fill={solid ? '#16a34a' : 'rgba(2,6,23,0.8)'} stroke={solid ? '#fff' : '#4ade80'} strokeWidth={solid ? 1.4 : 2} strokeLinejoin="round" />
    </svg>
  ),
  landing: (solid: boolean) => (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="7" fill={solid ? '#2563eb' : 'rgba(2,6,23,0.8)'} stroke={solid ? '#fff' : '#60a5fa'} strokeWidth={solid ? 1.4 : 2} />
      <text x="10" y="13.5" textAnchor="middle" fontSize="9" fontWeight="700" fill={solid ? '#fff' : '#93c5fd'}>
        A
      </text>
    </svg>
  ),
};

/** What the colours and lines of the map mean (shown in the Calques panel). */
export function LegendBody() {
  const { overlay, particleColor, layers } = useApp();
  const sites = layers.sitesOfficial || layers.takeoffs || layers.landings || layers.sitesCommunity;
  return (
    <div className="legend-body">
      {sites && (
        <div className="legend-block">
          <h4>Sites de vol</h4>
          <div className="swatches sym">
            <span>{Sym.takeoff(true)} déco officiel FFVL</span>
            <span>{Sym.takeoff(false)} déco non officiel</span>
            <span>{Sym.landing(true)} atterro officiel FFVL</span>
            <span>{Sym.landing(false)} atterro non officiel</span>
          </div>
          <p className="hint">Un seul symbole par lieu : le survol nomme le reste (piège, thermique…), la fiche le détaille.</p>
        </div>
      )}
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
      {(layers.breezes || layers.comets) && (
        <div className="legend-block">
          <h4>Brises documentées</h4>
          <div className="swatches">
            {(['valley', 'slope', 'lake', 'plain-to-mountain', 'pass-transfer', 'downvalley'] as const).map((k) => (
              <span key={k}>
                <i className="line" style={{ background: BREEZE_COLORS[k] }} /> {KIND_LABELS[k]}
              </span>
            ))}
            <span>
              <i className="line dashed" style={{ color: BREEZE_COLORS.valley }} /> déduction
            </span>
            <span>
              <i className="line" style={{ background: COLORS.convergence }} /> convergence
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
