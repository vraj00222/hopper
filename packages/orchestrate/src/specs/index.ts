/**
 * The built-in .pipe spec.
 *
 * A RocketRide pipeline is portable JSON, which is the entire reason §4.3 works:
 * the graph can store one as `Pipeline.spec_json` and hand it back as a string.
 * So the artifact on disk is the source of truth here too — `default.pipe.json`
 * is read and parsed, not hand-written twice.
 *
 * `/pipelines/*.json` belongs to @hopper/meta. We read it if it exists. We never
 * write there.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PipelineSpec } from '@hopper/contracts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** the portable JSON, verbatim — this is what a graph node would store */
export const DEFAULT_SPEC_JSON: string = readFileSync(
  path.join(HERE, 'default.pipe.json'),
  'utf8',
);

export const DEFAULT_SPEC: PipelineSpec = JSON.parse(DEFAULT_SPEC_JSON) as PipelineSpec;

export const DEFAULT_PIPELINE_ID = DEFAULT_SPEC.id;

/**
 * Read every `*.json` spec in a directory (default: the repo's `/pipelines`).
 * Returns raw JSON strings; the caller runs them through `runtime.loadFromJson`
 * so a bad file fails loudly with the same validator everything else uses.
 */
export function readSpecDir(dir?: string): Array<{ file: string; json: string }> {
  const target = dir ?? path.resolve(HERE, '..', '..', '..', '..', 'pipelines');
  if (!existsSync(target)) return [];
  const out: Array<{ file: string; json: string }> = [];
  for (const f of readdirSync(target).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push({ file: path.join(target, f), json: readFileSync(path.join(target, f), 'utf8') });
    } catch {
      // an unreadable file is not a reason to stop the demo
    }
  }
  return out;
}
