/**
 * Wind settings at the foot of the left column (desktop): the synoptic wind
 * (direction, strength, typical situations) and the analysis drawn on the
 * relief. It never moves: whatever opens in the column (a probed point, the
 * routes, a feature) stacks above it. When that content needs the height, the
 * panel folds to a one-line bar showing the current wind, one click to unfold.
 */
import { compassFr } from '@brises/model';
import type { Map as MlMap } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { SECTOR_ZOOM } from '../map/modules/schema';
import { remember, useApp, useRuntime } from '../state/store';
import { Disclosure, HeightSetting, OVERLAYS, PRESETS, WindExtras } from './ControlPanel';
import { getController } from './controller-ref';
import { IconChevron, IconWind } from './icons';
import { useIsMobile } from './mobile';
import { useMode } from './modes';
import { WindDial } from './WindDial';

/** The typical situations shown on the panel (all of them in the conditions). */
const QUICK = ['Calme', 'NO faible', 'Bise', 'Ouest', 'Sud · foehn', 'Mistral'];

/** Map zoomed out to the sector map (the massif shapes), where wind settings have nothing to show. */
function useSectorMap(): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    let map: MlMap | null = null;
    let retry = 0;
    const update = () => setOut(!!map && map.getZoom() < SECTOR_ZOOM);
    // The map is created after the first render: wait for it.
    const attach = () => {
      const c = getController();
      if (!c) {
        retry = window.setTimeout(attach, 300);
        return;
      }
      map = c.map;
      map.on('zoomend', update);
      update();
    };
    attach();
    return () => {
      window.clearTimeout(retry);
      map?.off('zoomend', update);
    };
  }, []);
  return out;
}

/** Shown on the live map and in the cross, zoomed in; the massif diagrams and the sector map have their own reading. */
export function useWindPanelVisible(): boolean {
  const mobile = useIsMobile();
  const touring = useApp((s) => s.tourStep !== null);
  const mode = useMode();
  const sectorMap = useSectorMap();
  return !mobile && !touring && mode !== 'massifs' && !sectorMap;
}

export function WindPanel() {
  const { synopticFrom, synopticKmh, overlay, overlayOpacity, windOpen, browseOpen, browseTab, set } = useApp();
  const feature = useRuntime((r) => r.feature);
  const probe = useRuntime((r) => r.probe);
  const details = useRuntime((r) => r.probeDetails);
  const visible = useWindPanelVisible();
  // Unfolded on purpose over a long content: valid for that content only.
  const [peekFor, setPeekFor] = useState<string | null>(null);
  if (!visible) return null;

  // Long content above (a feature, the probe's details, the route list): the panel yields its height.
  const busy = !!feature || (!!probe && details) || (browseOpen && !probe);
  const contentKey = feature?.ref ?? (probe ? `probe:${probe.lon},${probe.lat}` : `browse:${browseTab}`);
  const open = busy ? peekFor === contentKey : windOpen;
  const toggle = () => {
    if (open) {
      if (busy) setPeekFor(null);
      else {
        set({ windOpen: false });
        remember('brises.wind', 'folded');
      }
    } else if (probe && details) {
      // The probe goes back to its summary: room for both.
      useRuntime.getState().set({ probeDetails: false });
      set({ windOpen: true });
      remember('brises.wind', 'open');
    } else if (busy) setPeekFor(contentKey);
    else {
      set({ windOpen: true });
      remember('brises.wind', 'open');
    }
  };

  const calm = synopticKmh < 3;
  const current = OVERLAYS.find((o) => o.key === overlay);
  const summary = `${calm ? 'calme' : `${compassFr(synopticFrom)} ${synopticKmh} km/h`}${overlay !== 'none' ? ` · ${current?.label}` : ''}`;
  return (
    <section className={`wind-panel panel ${open ? 'open' : ''}`} aria-label="Vent météo et analyse du relief">
      <button className="wind-panel-head" onClick={toggle} aria-expanded={open}>
        <IconWind size={16} />
        <b>Vent météo</b>
        {!open && <span className="wind-panel-sum">{summary}</span>}
        <IconChevron size={15} className="chev" />
      </button>
      {open && (
        <div className="wind-panel-body">
          <div className="wind-panel-wind">
            <WindDial fromDeg={synopticFrom} speedKmh={synopticKmh} onChange={(d) => set({ synopticFrom: d })} />
            <label className="wind-panel-speed">
              <span>
                Force aux crêtes <b>{calm ? 'calme' : `${synopticKmh} km/h`}</b>
              </span>
              <input type="range" min={0} max={60} step={1} value={synopticKmh} onChange={(e) => set({ synopticKmh: Number(e.target.value) })} />
            </label>
          </div>
          <div className="chips" role="group" aria-label="Situations types">
            {PRESETS.filter((p) => QUICK.includes(p.label)).map((p) => (
              <button
                key={p.label}
                className={`chip ${synopticKmh === p.kmh && (p.kmh === 0 || synopticFrom === p.from) ? 'active' : ''}`}
                title={p.hint || undefined}
                onClick={() => set({ synopticFrom: p.from, synopticKmh: p.kmh })}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="wind-panel-title">Analyse sur le relief</p>
          <div className="wind-panel-overlays" role="radiogroup" aria-label="Analyse sur le relief">
            {OVERLAYS.map((o) => (
              <button key={o.key} role="radio" aria-checked={overlay === o.key} className={overlay === o.key ? 'on' : ''} title={o.hint || undefined} onClick={() => set({ overlay: o.key })}>
                {o.label}
              </button>
            ))}
          </div>
          {overlay !== 'none' && (
            <div className="wind-panel-overlay-opts">
              <p className="hint">{current?.hint}</p>
              <label className="field">
                <span>
                  Opacité <b>{Math.round(overlayOpacity * 100)} %</b>
                </span>
                <input type="range" min={0.2} max={1} step={0.05} value={overlayOpacity} onChange={(e) => set({ overlayOpacity: Number(e.target.value) })} />
              </label>
            </div>
          )}
          <div className="more">
            <Disclosure label="Plus de réglages">
              <WindExtras />
              <p className="wind-panel-title">Hauteur de lecture</p>
              <HeightSetting />
            </Disclosure>
          </div>
        </div>
      )}
    </section>
  );
}
