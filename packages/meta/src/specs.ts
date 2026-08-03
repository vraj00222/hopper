/**
 * Loading the portable pipeline JSON off disk, and expanding the partial
 * AdvisoryClass matchers each spec declares into concrete class nodes.
 *
 * The files in /pipelines are the source of truth exactly once - at seed time.
 * After that the graph holds them as `spec_json` on a Pipeline node and the
 * runtime reads them from there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdvisoryClass, Ecosystem, PipelineSpec } from '@hopper/contracts';
import { classId } from '@hopper/contracts';

import { validateSpec } from './validate.js';

export const PIPELINE_FILES = [
  'deep-traversal.pipe.json',
  'fast-suppress.pipe.json',
  'chokepoint-priority.pipe.json',
] as const;

export const PIPELINE_IDS = [
  'pipe_deep_traversal',
  'pipe_fast_suppress',
  'pipe_chokepoint_priority',
] as const;

export type PipelineId = (typeof PIPELINE_IDS)[number];

const ECOSYSTEMS: Ecosystem[] = ['npm', 'pypi', 'go', 'maven', 'cargo', 'rubygems'];
const SEVERITY_BANDS: AdvisoryClass['severity_band'][] = ['low', 'moderate', 'high', 'critical'];
const DEPTH_BANDS: AdvisoryClass['depth_band'][] = ['none', 'direct', 'shallow', 'deep'];

/**
 * Starting stats, distinct on purpose. Selection has to visibly differ on the
 * very first advisory of the demo - a cold library where everything is 0/0 is
 * a coin flip, and a coin flip proves nothing about the graph choosing.
 *
 *   deep-traversal        16/17 = 94%   1800ms   thorough, slow, mostly right
 *   chokepoint-priority   10/12 = 83%    900ms   fast pager, occasionally wrong
 *   fast-suppress         39/40 = 98%     40ms   nearly free, nearly always right
 */
export const SEED_STATS: Record<PipelineId, { successes: number; runs: number; avg_latency: number }> = {
  pipe_deep_traversal: { successes: 16, runs: 17, avg_latency: 1800 },
  pipe_chokepoint_priority: { successes: 10, runs: 12, avg_latency: 900 },
  pipe_fast_suppress: { successes: 39, runs: 40, avg_latency: 40 },
};

let cached: PipelineSpec[] | null = null;

/** find the repo-root pipelines/ directory from wherever this module was loaded */
export function pipelinesDir(): string {
  const override = process.env.HOPPER_PIPELINES_DIR;
  if (override && existsSync(override)) return override;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, 'pipelines');
    if (PIPELINE_FILES.every((f) => existsSync(join(candidate, f)))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    '@hopper/meta: cannot locate the pipelines/ directory (set HOPPER_PIPELINES_DIR to point at it)',
  );
}

/** the three specs, parsed and structurally validated. Cached after first read. */
export function loadSpecs(force = false): PipelineSpec[] {
  if (cached && !force) return cached;
  const dir = pipelinesDir();
  const specs: PipelineSpec[] = [];
  for (const file of PIPELINE_FILES) {
    const path = join(dir, file);
    let parsed: PipelineSpec;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as PipelineSpec;
    } catch (e) {
      throw new Error(`@hopper/meta: ${file} is not valid JSON - ${(e as Error).message}`);
    }
    const v = validateSpec(parsed);
    if (!v.ok) throw new Error(`@hopper/meta: ${file} is structurally invalid - ${v.errors.join('; ')}`);
    specs.push(parsed);
  }
  cached = specs;
  return specs;
}

export function specById(id: string): PipelineSpec | null {
  return loadSpecs().find((s) => s.id === id) ?? null;
}

export function parseSpecJson(json: string, fallbackId?: string): PipelineSpec | null {
  try {
    const parsed = JSON.parse(json) as PipelineSpec;
    if (validateSpec(parsed).ok) return parsed;
  } catch {
    /* fall through to the on-disk copy */
  }
  return fallbackId ? specById(fallbackId) : null;
}

export function makeClass(
  ecosystem: Ecosystem,
  severity_band: AdvisoryClass['severity_band'],
  depth_band: AdvisoryClass['depth_band'],
): AdvisoryClass {
  return { id: classId(ecosystem, severity_band, depth_band), ecosystem, severity_band, depth_band };
}

/**
 * `handles[]` entries are Partial<AdvisoryClass>. Any field left out means "all
 * of them", so expand the cross-product into concrete classes before writing
 * HANDLES edges. Our own specs are always fully specified, but a spec authored
 * on the RocketRide canvas may not be.
 */
export function expandHandles(spec: PipelineSpec): AdvisoryClass[] {
  const out = new Map<string, AdvisoryClass>();
  for (const h of spec.handles ?? []) {
    const ecos = h.ecosystem ? [h.ecosystem] : ECOSYSTEMS;
    const sevs = h.severity_band ? [h.severity_band] : SEVERITY_BANDS;
    const depths = h.depth_band ? [h.depth_band] : DEPTH_BANDS;
    for (const e of ecos) {
      for (const s of sevs) {
        for (const d of depths) {
          const cls = makeClass(e, s, d);
          out.set(cls.id, cls);
        }
      }
    }
  }
  return [...out.values()];
}

/** does this spec claim the class, locally? Used by the offline fallback. */
export function handlesClass(spec: PipelineSpec, cls: AdvisoryClass): boolean {
  return (spec.handles ?? []).some(
    (h) =>
      (h.ecosystem === undefined || h.ecosystem === cls.ecosystem) &&
      (h.severity_band === undefined || h.severity_band === cls.severity_band) &&
      (h.depth_band === undefined || h.depth_band === cls.depth_band),
  );
}

/**
 * Widening may cross severity and depth, but never the zero-path boundary.
 *
 * depth_band 'none' is not "a bit shallower" - it means the traversal found no
 * path at all, and the pipelines built for it (fast-suppress) skip the entire
 * analysis. Letting a 'none' handler widen onto a class that has paths would
 * suppress a live advisory on the strength of its success rate alone. So the
 * two sides of that boundary widen only among themselves.
 */
function depthCompatible(h: Partial<AdvisoryClass>, cls: AdvisoryClass): boolean {
  if (h.depth_band === undefined) return true;
  return (h.depth_band === 'none') === (cls.depth_band === 'none');
}

/** widened local match: same ecosystem + severity band, any compatible depth */
export function handlesEcosystemSeverity(spec: PipelineSpec, cls: AdvisoryClass): boolean {
  return (spec.handles ?? []).some(
    (h) =>
      (h.ecosystem === undefined || h.ecosystem === cls.ecosystem) &&
      (h.severity_band === undefined || h.severity_band === cls.severity_band) &&
      depthCompatible(h, cls),
  );
}

/** widest local match: same ecosystem, any compatible depth */
export function handlesEcosystem(spec: PipelineSpec, cls: AdvisoryClass): boolean {
  return (spec.handles ?? []).some(
    (h) => (h.ecosystem === undefined || h.ecosystem === cls.ecosystem) && depthCompatible(h, cls),
  );
}

/** any ecosystem, any severity, compatible depth — the last guarded rung */
export function handlesAnything(spec: PipelineSpec, cls: AdvisoryClass): boolean {
  return (spec.handles ?? []).some((h) => depthCompatible(h, cls));
}
