/**
 * HOPPER — the three demo advisories and their AFFECTS edges.
 *
 * The hero and precedent advisories point at packages that genuinely exist in
 * the deps.dev closure. The suppressed one points at @angular/compiler, which
 * is deliberately absent from every repo's closure — its Package node exists
 * and is isolated, so Q2 walks the graph and comes back with zero, rather than
 * failing to find a node and getting zero for free.
 */
import {
  HERO_ADVISORY,
  PRECEDENT_ADVISORY,
  SUPPRESSED_ADVISORY,
  SUPPRESSED_PACKAGE,
} from '@hopper/contracts';
import type { Advisory } from '@hopper/contracts';
import type { Dataset } from '../dataset.js';
import { emptyDataset } from '../dataset.js';

export const DEMO_ADVISORIES: Advisory[] = [
  HERO_ADVISORY,
  SUPPRESSED_ADVISORY,
  PRECEDENT_ADVISORY,
];

export function advisoryDataset(): Dataset {
  const ds = emptyDataset();
  ds.advisories = DEMO_ADVISORIES;
  ds.affects = DEMO_ADVISORIES.map((a) => ({
    ghsa_id: a.ghsa_id,
    package: a.package_name,
    range: a.vulnerable_range,
    fixed_in: a.fixed_in,
  }));
  // ensure the isolated node exists so absence is proved, not assumed
  ds.packages = [{ name: SUPPRESSED_PACKAGE, ecosystem: 'npm', version: '17.3.11' }];
  return ds;
}
