// LLM-based query translator (Node-only)
// Uses Ollama for natural language to ParsedQuery translation
// Not exported from main index.ts to keep core browser-safe

import type { ParsedQuery } from './query.js';

export interface LLMQueryOptions {
  /** Ollama base URL (default: http://localhost:11434) */
  baseUrl?: string;
  /** Model name (default: llama3.2) */
  model?: string;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
  /** Temperature for generation (default: 0.1 for deterministic output) */
  temperature?: number;
}

const DEFAULT_OPTIONS: Required<LLMQueryOptions> = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2',
  timeout: 5000,
  temperature: 0.1,
};

const SYSTEM_PROMPT = `You are a query parser for a filesystem activity ledger.
Convert natural language queries into a strict JSON object matching this TypeScript interface:

interface ParsedQuery {
  since?: number;      // Unix timestamp (ms) - lower time bound
  until?: number;      // Unix timestamp (ms) - upper time bound
  path?: string;       // Relative path filter (e.g., "src", "docs")
  eventType?: 'create' | 'modify' | 'delete' | 'rename';
  limit?: number;      // Maximum results
  projectName?: string;
}

Rules:
- Return ONLY valid JSON, no markdown, no explanation.
- Timestamps must be Unix milliseconds (Date.now()).
- For relative times like "Tuesday", "last week", "3 days ago", calculate from the current time provided in the prompt.
- "what changed" / "what happened" means no eventType filter (return all types).
- "new files" / "created" / "added" => eventType: "create"
- "modified" / "edited" / "updated" => eventType: "modify"
- "deleted" / "removed" => eventType: "delete"
- "renamed" / "moved" => eventType: "rename"
- Path filters: extract folder/path after "in", "under", "inside" (but not "in my project")
- Limits: "top 10", "latest 5", "first 20" => limit: number
- If the query is ambiguous, make a reasonable best guess.`;

function buildUserPrompt(query: string, now: number): string {
  const nowIso = new Date(now).toISOString();
  return `Current time: ${nowIso} (${now}ms)

Query: "${query}"

Return ParsedQuery JSON:`;
}

export function parseLLMResponse(response: string): ParsedQuery {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in LLM response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${e}`);
  }

  // Validate the structure
  const result: ParsedQuery = {};

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM response is not an object');
  }

  const p = parsed as Record<string, unknown>;

  if (typeof p.since === 'number') result.since = p.since;
  if (typeof p.until === 'number') result.until = p.until;
  if (typeof p.path === 'string') result.path = p.path;
  if (
    typeof p.eventType === 'string' &&
    ['create', 'modify', 'delete', 'rename'].includes(p.eventType)
  ) {
    result.eventType = p.eventType as ParsedQuery['eventType'];
  }
  if (typeof p.limit === 'number' && p.limit > 0) result.limit = Math.floor(p.limit);
  if (typeof p.projectName === 'string') result.projectName = p.projectName;

  return result;
}

/**
 * Translate a natural language query using Ollama.
 * Returns ParsedQuery on success, throws on failure (caller handles fallback).
 */
export async function translateWithLLM(
  query: string,
  options: LLMQueryOptions = {}
): Promise<ParsedQuery> {
  // Filter out undefined values to preserve defaults
  const filteredOptions: LLMQueryOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      (filteredOptions as Record<string, unknown>)[key] = value;
    }
  }
  const opts = { ...DEFAULT_OPTIONS, ...filteredOptions };
  const now = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

  try {
    const response = await fetch(`${opts.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        prompt: buildUserPrompt(query, now),
        system: SYSTEM_PROMPT,
        stream: false,
        options: {
          temperature: opts.temperature,
          num_predict: 200,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama request failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { response?: string };
    const text = data.response?.trim();

    if (!text) {
      throw new Error('Empty response from Ollama');
    }

    return parseLLMResponse(text);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${opts.timeout}ms`);
    }
    throw e;
  }
}

/**
 * Check if Ollama is available and the model is loaded.
 * Useful for health checks before attempting translation.
 */
export async function checkOllamaHealth(
  options: LLMQueryOptions = {}
): Promise<boolean> {
  // Filter out undefined values to preserve defaults
  const filteredOptions: LLMQueryOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      (filteredOptions as Record<string, unknown>)[key] = value;
    }
  }
  const opts = { ...DEFAULT_OPTIONS, ...filteredOptions };

  try {
    const response = await fetch(`${opts.baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name.startsWith(opts.model)) ?? false;
  } catch {
    return false;
  }
}

/**
 * High-level function that tries LLM first, falls back to rule parser on any failure.
 * This is the main entry point for the CLI.
 */
export async function parseQueryWithLLMFallback(
  query: string,
  ruleParser: (q: string) => ParsedQuery,
  llmOptions: LLMQueryOptions = {},
  llmEnabled?: boolean
): Promise<{ parsed: ParsedQuery; usedLLM: boolean }> {
  // Filter out undefined values to preserve defaults
  const filteredOptions: LLMQueryOptions = {};
  for (const [key, value] of Object.entries(llmOptions)) {
    if (value !== undefined) {
      (filteredOptions as Record<string, unknown>)[key] = value;
    }
  }

  // Check if LLM is enabled via explicit parameter or env var
  const enabled = llmEnabled ?? (process.env.ACTIS_LLM_ENABLED === 'true');

  if (!enabled) {
    return { parsed: ruleParser(query), usedLLM: false };
  }

  try {
    const parsed = await translateWithLLM(query, filteredOptions);
    return { parsed, usedLLM: true };
  } catch (e) {
    // Fallback to rule parser on any error (timeout, network, parse error, etc.)
    console.error(
      `LLM query failed, falling back to rule parser: ${e instanceof Error ? e.message : String(e)}`
    );
    return { parsed: ruleParser(query), usedLLM: false };
  }
}