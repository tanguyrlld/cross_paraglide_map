import type { Atlas, ContributionInput } from '@brises/shared';
import { create } from 'zustand';
import type { Level } from '../glossary';
import type { PowerMode } from '../map/frame-pacer';
import type { OverlayMode } from '../engine/cpu-overlays';
import type { FeatureDetails } from '../map/modules/types';
import type { ProbeResult } from '../map/modules/wind';

/** Time slots of the schematic view (typical summer thermal day). */
export type SchemaPhase = 'morning' | 'midday' | 'afternoon' | 'evening';
export const SCHEMA_PHASES: { key: SchemaPhase; label: string; hours: [number, number] }[] = [
  { key: 'morning', label: 'Matin', hours: [7, 11] },
  { key: 'midday', label: 'Midi', hours: [11, 14] },
  { key: 'afternoon', label: 'Après-midi', hours: [14, 18] },
  { key: 'evening', label: 'Soir', hours: [18, 21.5] },
];

/** What the massif diagram shows besides its breezes (always drawn). */
export type SchemaLayerKey = 'thermals' | 'hazards' | 'takeoffs' | 'landings' | 'convergences' | 'routes';

/** Panels shown as bottom sheets on phones (one at a time). */
export type MobileSheet = 'none' | 'browse';

export type Basemap = 'topo' | 'ign-ortho' | 'relief';

export type LayerKey =
  | 'particles'
  | 'comets'
  | 'thermalColumns'
  | 'breezes'
  | 'convergences'
  | 'hazards'
  | 'thermals'
  | 'soaring'
  | 'takeoffs'
  | 'landings'
  | 'routes'
  | 'sitesOfficial'
  | 'sitesCommunity'
  | 'airspace'
  | 'airspaceProtect'
  | 'airspaceActivity'
  | 'labels'
  | 'kk7Thermals'
  | 'kk7Skyways'
  | 'hillshade';

/** User-facing settings: everything that defines what the map simulates and shows. */
export interface AppState {
  month0: number;
  day: number;
  hour: number;
  playing: boolean;
  synopticFrom: number;
  synopticKmh: number;
  heightMode: 'agl' | 'asl';
  heightAgl: number;
  heightAsl: number;
  breezeScale: number;
  /** Heatwave day: enables the breezes documented « par forte chaleur ». */
  heatwave: boolean;
  /** Energy budget of the rendering, chosen automatically (battery, device, activity). */
  power: PowerMode;
  overlay: OverlayMode;
  overlayOpacity: number;
  layers: Record<LayerKey, boolean>;
  basemap: Basemap;
  exaggeration: number;
  particleCount: number;
  particleSpeed: number;
  particleColor: 'speed' | 'lift';
  selectedMassif: string | null;
  /** Schematic, flattened all-in-one view of a massif (null = live 3D view). */
  schemaMassif: string | null;
  schemaPhase: SchemaPhase;
  /** Waiting for the user to pick a massif on the map for the schema view. */
  schemaPicking: boolean;
  /** Schema drawn on the 3D relief instead of a flat map. */
  schema3d: boolean;
  /** Animated wind under the schema: particles, documented breeze flows, thermal columns. */
  schemaWind: boolean;
  /** Families drawn on the massif diagram (a short default; the rest on demand, all during a visit). */
  schemaLayers: Record<SchemaLayerKey, boolean>;
  /** Guided presentation of the schema massif: current step, null when off. */
  tourStep: number | null;
  /** Right-hand settings panel (desktop). */
  panelOpen: boolean;
  /** On-demand panel: conditions (from the time bar) or layers (from the map). */
  popover: 'conditions' | 'layers' | null;
  /** Left-hand sector list (desktop); sheets of a sector, feature or schema open it on their own. */
  browseOpen: boolean;
  mobileSheet: MobileSheet;
  aboutOpen: boolean;
  /** Level of detail chosen on the welcome card (remembered in this browser). */
  level: Level;
  welcomeOpen: boolean;
  /** Left panel tab: sectors or cross-country routes. */
  browseTab: 'massifs' | 'routes';
  /** Wind panel unfolded at the foot of the left column (desktop, remembered in this browser). */
  windOpen: boolean;
  set: (patch: Partial<AppState>) => void;
  toggleLayer: (key: LayerKey) => void;
}

/** Per-browser convenience settings (never required: the app works without storage). */
function remembered<T extends string, D>(key: string, allowed: readonly T[], fallback: D): T | D {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    // Storage unavailable: default.
  }
  return fallback;
}

const PHONE_START = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 860px)').matches;

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted: still applied for this visit.
  }
}

const isSmall = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 860px)').matches;

export const useApp = create<AppState>((set) => ({
  // Default: a typical July thermal day, mid-afternoon, no synoptic wind.
  month0: 6,
  day: 15,
  hour: 15,
  playing: false,
  synopticFrom: 315,
  synopticKmh: 0,
  heightMode: 'agl',
  heightAgl: 80,
  heightAsl: 1500,
  breezeScale: 1,
  heatwave: false,
  power: 'auto',
  overlay: 'none',
  overlayOpacity: 0.85,
  layers: {
    particles: true,
    comets: true,
    thermalColumns: true,
    breezes: true,
    convergences: false,
    hazards: true,
    thermals: true,
    soaring: false,
    takeoffs: true,
    landings: true,
    routes: false,
    sitesOfficial: true,
    sitesCommunity: false,
    airspace: false,
    airspaceProtect: false,
    airspaceActivity: false,
    labels: true,
    kk7Thermals: false,
    kk7Skyways: false,
    hillshade: true,
  },
  basemap: 'topo',
  // 3D by default everywhere; a phone stays flat only if its user chose 2D (button remembered).
  exaggeration: PHONE_START && remembered('brises.relief', ['2d'] as const, null) === '2d' ? 0 : 1.3,
  particleCount: isSmall ? 7000 : 16000,
  particleSpeed: 1,
  particleColor: 'speed',
  selectedMassif: null,
  schemaMassif: null,
  schemaPhase: 'afternoon',
  schemaPicking: false,
  // Massif diagrams in relief by default (flat on demand).
  schema3d: true,
  schemaWind: false,
  schemaLayers: { thermals: true, hazards: true, takeoffs: true, landings: false, convergences: false, routes: false },
  tourStep: null,
  panelOpen: !isSmall,
  popover: null,
  browseOpen: false,
  mobileSheet: 'none',
  aboutOpen: false,
  level: remembered('brises.level', ['decouverte', 'pilote', 'expert'] as const, 'pilote'),
  welcomeOpen: remembered('brises.welcomed', ['1'] as const, null) === null,
  browseTab: 'massifs',
  windOpen: remembered('brises.wind', ['folded'] as const, null) === null,
  set: (patch) => set(patch),
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
}));

export const CURRENT_YEAR = new Date().getFullYear();

// ---------- Runtime state fed by the map controller ----------

export interface ContributionDraft {
  kind: ContributionInput['kind'];
  targetRef?: string;
  targetTitle?: string;
  category?: ContributionInput['category'];
  /** Points picked on the map (one for a spot, several for a breeze path). */
  points: [number, number][];
  picking: boolean;
}

export interface RuntimeState {
  atlas: Atlas | null;
  dataMode: 'api' | 'static' | null;
  status: { phase: 'loading' | 'terrain' | 'ready' | 'error'; message?: string };
  moduleMessage: string | null;
  sun: { azimuth: number; elevation: number } | null;
  solarHour: number | null;
  probe: { lon: number; lat: number; result: ProbeResult | null } | null;
  /** The probe's breakdown, sources and forecast unfolded (the wind panel folds meanwhile). */
  probeDetails: boolean;
  feature: FeatureDetails | null;
  draft: ContributionDraft | null;
  /** Route being planned or highlighted: turn points and whether map clicks add points. */
  plan: { points: [number, number][]; names: string[]; picking: boolean; title?: string } | null;
  toast: string | null;
  set: (patch: Partial<RuntimeState>) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  atlas: null,
  dataMode: null,
  status: { phase: 'loading', message: 'Initialisation…' },
  moduleMessage: null,
  sun: null,
  solarHour: null,
  probe: null,
  probeDetails: false,
  feature: null,
  draft: null,
  plan: null,
  toast: null,
  set: (patch) => set(patch),
}));
