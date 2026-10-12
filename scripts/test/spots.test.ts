import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Atlas } from '@brises/shared';
import { describe, expect, it } from 'vitest';
import { hazardDuplicates, isSoaring, usableConvergences } from '../../apps/web/src/map/spots';

const atlas = JSON.parse(readFileSync(join(process.cwd(), 'apps/web/public/data/atlas.json'), 'utf8')) as Atlas;

describe('one hazard per subject', () => {
  const dups = hazardDuplicates(atlas);

  it('merges the three accounts of the ZIT de Grenoble into the local one', () => {
    const zit = ['chartreuse/zit-grenoble', 'grenoble-cuvette/zit-grenoble-transition-moucherotte-chartreuse', 'alpes-francaises/zit-grenoble-p14'];
    const kept = zit.filter((id) => !dups.has(id));
    expect(kept).toHaveLength(1);
    // A sector's account rather than the whole-Alps page.
    expect(kept[0]).not.toMatch(/^alpes-francaises\//);
    for (const id of zit) if (id !== kept[0]) expect(dups.get(id)).toBe(kept[0]);
  });

  it('keeps two zones told apart in brackets', () => {
    const verdon = atlas.features.hazards.filter((f) => /nidification de l'aigle royal \(gorges du Verdon/.test(f.properties.name));
    expect(verdon.length).toBeGreaterThanOrEqual(2);
    expect(verdon.filter((f) => !dups.has(f.properties.id)).length).toBe(verdon.length);
  });

  it('keeps different dangers at the same place', () => {
    const parves = atlas.features.hazards.filter((f) => f.properties.name.startsWith('Montagne de Parves'));
    expect(parves.filter((f) => !dups.has(f.properties.id)).length).toBe(parves.length);
  });
});

describe('convergences pilots can use', () => {
  const ids = usableConvergences(atlas);

  it('keeps the Grenoble confluence once (varios of 2 to 3 m/s), drops its duplicate', () => {
    const both = ['gresivaudan/confluence-grenoble', 'grenoble-cuvette/confluence-ne-grenoble'].filter((id) => ids.has(id));
    expect(both).toHaveLength(1);
  });

  it('drops inferences and warnings of turbulence', () => {
    expect(ids.has('belledonne/conflit-brises-sept-laux')).toBe(false);
    for (const f of atlas.features.convergences) if (/déduction/.test(JSON.stringify(f.properties.details ?? {}))) expect(ids.has(f.properties.id)).toBe(false);
  });
});

describe('soaring spots', () => {
  it('does not call thermodynamic cliff flying soaring', () => {
    const hilaire = atlas.features.soaring.find((f) => f.properties.id === 'chartreuse/falaises-est-st-hilaire')!;
    expect(isSoaring(hilaire)).toBe(false);
    expect(atlas.features.soaring.some((f) => /soaring/i.test(f.properties.name) && isSoaring(f))).toBe(true);
  });
});
