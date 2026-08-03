/**
 * HOPPER — schema application.
 *
 * `contracts/src/schema.cypher` is the single source of truth for the ontology.
 * We read it, split on ';', drop comments and blanks, and apply each statement.
 * Re-running is a no-op: FalkorDB answers "Attribute 'x' is already indexed",
 * which is a success for our purposes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FalkorClient } from './client.js';

const ALREADY = /already indexed|already exists|constraint already/i;

const here = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  // packages/graph/src -> repo root -> contracts/src/schema.cypher
  resolve(here, '../../../contracts/src/schema.cypher'),
  resolve(here, '../../../../contracts/src/schema.cypher'),
  resolve(process.cwd(), 'contracts/src/schema.cypher'),
  resolve(process.cwd(), '../../contracts/src/schema.cypher'),
];

let cached: string | null = null;

export function schemaPath(): string {
  for (const p of CANDIDATES) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error(
    `contracts/src/schema.cypher not found. Looked in:\n  ${CANDIDATES.join('\n  ')}`,
  );
}

export function readSchema(): string {
  if (cached !== null) return cached;
  cached = readFileSync(schemaPath(), 'utf8');
  return cached;
}

/** split on ';', strip `//` comments and blank lines, keep order */
export function schemaStatements(source = readSchema()): string[] {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

export interface SchemaResult {
  applied: number;
  skipped: number;
  statements: number;
}

export async function applySchemaTo(client: FalkorClient): Promise<SchemaResult> {
  const statements = schemaStatements();
  let applied = 0;
  let skipped = 0;
  for (const stmt of statements) {
    const r = await client.queryTolerant(stmt, ALREADY);
    if (r === 'ok') applied += 1;
    else skipped += 1;
  }
  return { applied, skipped, statements: statements.length };
}
