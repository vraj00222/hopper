/**
 * The optional model path.
 *
 * MOCK=true (the default) is fully deterministic and offline: this module is never
 * even imported into a request path, and `@anthropic-ai/sdk` is not loaded. The SDK is
 * imported dynamically and only when MOCK=false and ANTHROPIC_API_KEY is present.
 *
 * The model never sees a credential value: prompts are built from the grounded input
 * only (advisory, hop paths, telemetry, precedents) and are passed through the redactor
 * before they leave the process. Model output is repaired against the deterministic
 * verdict and validated strictly; anything that survives neither is discarded and the
 * deterministic verdict stands, with the failure recorded in the session trace.
 */
import type { AgentName } from '@hopper/contracts';

import type { Redactor } from './redact.js';

export const MODEL_ID = 'claude-opus-5';

export interface Llm {
  readonly model: string;
  /** returns parsed JSON from the model, or throws */
  json(agent: AgentName, system: string, user: string): Promise<unknown>;
}

export interface LlmOptions {
  mock: boolean;
  redactor: Redactor;
  apiKey?: string | null;
}

/** null whenever we must stay deterministic and offline */
export function createLlm(opts: LlmOptions): Llm | null {
  const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (opts.mock || !key) return null;

  let clientPromise: Promise<{
    messages: {
      create(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  }> | null = null;

  const client = async () => {
    if (!clientPromise) {
      clientPromise = import('@anthropic-ai/sdk').then((mod) => {
        const Anthropic = (mod as { default: new (o: { apiKey: string }) => unknown }).default;
        return new Anthropic({ apiKey: key }) as never;
      });
    }
    return clientPromise;
  };

  return {
    model: MODEL_ID,
    async json(agent, system, user) {
      const sdk = await client();
      const res = await sdk.messages.create({
        model: MODEL_ID,
        max_tokens: 1200,
        temperature: 0,
        system: opts.redactor.text(system),
        messages: [{ role: 'user', content: opts.redactor.text(user) }],
      });
      const text = res.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
      return parseJson(agent, text);
    },
  };
}

function parseJson(agent: AgentName, text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`${agent}: model returned no JSON object`);
  return JSON.parse(body.slice(start, end + 1));
}

export const SYSTEM_PREFIX = [
  'You are an agent inside HOPPER, a vulnerability triage system.',
  'Your entire context is the grounded JSON given to you: a dependency subgraph walked in',
  'FalkorDB, runtime telemetry, and prior patch attempts. There is no vector store and no',
  'retrieval step. Do not speculate beyond that JSON.',
  'Voice: institutional, calm, factual. No hype, no apology, no emoji.',
  'Reply with a single JSON object matching the schema exactly. No prose outside the JSON.',
].join(' ');
