// llm-query.ts: LLM-based query translation tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translateWithLLM, parseLLMResponse, parseQueryWithLLMFallback, checkOllamaHealth } from '../src/llm-query.js';
import { parseNaturalQuery } from '../src/query.js';

// Mock fetch globally
const originalFetch = global.fetch;

describe('llm-query: parseLLMResponse', () => {
  it('parses valid JSON response with all fields', () => {
    const response = `{
      "since": 1700000000000,
      "until": 1700100000000,
      "path": "src",
      "eventType": "create",
      "limit": 10,
      "projectName": "my-project"
    }`;
    const result = parseLLMResponse(response);
    expect(result.since).toBe(1700000000000);
    expect(result.until).toBe(1700100000000);
    expect(result.path).toBe('src');
    expect(result.eventType).toBe('create');
    expect(result.limit).toBe(10);
    expect(result.projectName).toBe('my-project');
  });

  it('parses partial JSON response', () => {
    const response = `{"since": 1700000000000, "path": "docs"}`;
    const result = parseLLMResponse(response);
    expect(result.since).toBe(1700000000000);
    expect(result.path).toBe('docs');
    expect(result.until).toBeUndefined();
    expect(result.eventType).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it('extracts JSON from markdown code block', () => {
    const response = `\`\`\`json
    {"since": 1700000000000, "eventType": "modify"}
    \`\`\``;
    const result = parseLLMResponse(response);
    expect(result.since).toBe(1700000000000);
    expect(result.eventType).toBe('modify');
  });

  it('extracts JSON from text with explanation', () => {
    const response = `Here is the parsed query:
    {"since": 1700000000000}
    That should work.`;
    const result = parseLLMResponse(response);
    expect(result.since).toBe(1700000000000);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLLMResponse('not json')).toThrow('No JSON object found');
  });

  it('throws on non-object JSON', () => {
    expect(() => parseLLMResponse('"just a string"')).toThrow('No JSON object found');
  });

  it('ignores invalid eventType', () => {
    const response = `{"eventType": "invalid"}`;
    const result = parseLLMResponse(response);
    expect(result.eventType).toBeUndefined();
  });

  it('ignores negative limit', () => {
    const response = `{"limit": -5}`;
    const result = parseLLMResponse(response);
    expect(result.limit).toBeUndefined();
  });

  it('floats limit to integer', () => {
    const response = `{"limit": 10.9}`;
    const result = parseLLMResponse(response);
    expect(result.limit).toBe(10);
  });
});

describe('llm-query: translateWithLLM', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('calls Ollama API with correct parameters', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"since": 1700000000000}' }),
    });

    await translateWithLLM('test query', { baseUrl: 'http://test:11434', model: 'test-model', timeout: 1000 });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://test:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('test query'),
      })
    );
  });

  it('returns parsed query on success', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"since": 1700000000000, "path": "src"}' }),
    });

    const result = await translateWithLLM('what changed in src');
    expect(result.since).toBe(1700000000000);
    expect(result.path).toBe('src');
  });

  it('throws on HTTP error', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(translateWithLLM('test')).rejects.toThrow('Ollama request failed (500)');
  });

  it('throws on empty response', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '' }),
    });

    await expect(translateWithLLM('test')).rejects.toThrow('Empty response from Ollama');
  });

  it('throws on timeout', async () => {
    (global.fetch as vi.Mock).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 100))
    );

    await expect(translateWithLLM('test', { timeout: 50 })).rejects.toThrow('timed out after 50ms');
  });

  it('throws on network error', async () => {
    (global.fetch as vi.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(translateWithLLM('test')).rejects.toThrow('ECONNREFUSED');
  });
});

describe('llm-query: parseQueryWithLLMFallback', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    delete process.env.ACTIS_LLM_ENABLED;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('uses rule parser when ACTIS_LLM_ENABLED is not set', async () => {
    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery);
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
  });

  it('uses rule parser when ACTIS_LLM_ENABLED=false', async () => {
    process.env.ACTIS_LLM_ENABLED = 'false';
    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery);
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
  });

  it('uses LLM when ACTIS_LLM_ENABLED=true and Ollama succeeds', async () => {
    process.env.ACTIS_LLM_ENABLED = 'true';
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"since": 1700000000000, "path": "src"}' }),
    });

    const result = await parseQueryWithLLMFallback('what changed in src since Tuesday', parseNaturalQuery);
    expect(result.usedLLM).toBe(true);
    expect(result.parsed.since).toBe(1700000000000);
    expect(result.parsed.path).toBe('src');
  });

  it('falls back to rule parser when LLM fails', async () => {
    process.env.ACTIS_LLM_ENABLED = 'true';
    (global.fetch as vi.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery);
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
  });

  it('falls back to rule parser on LLM timeout', async () => {
    process.env.ACTIS_LLM_ENABLED = 'true';
    (global.fetch as vi.Mock).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 100))
    );

    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery, { timeout: 50 });
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
  });

  it('falls back to rule parser on invalid LLM response', async () => {
    process.env.ACTIS_LLM_ENABLED = 'true';
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: 'not valid json' }),
    });

    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery);
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
  });

  it('respects explicit llmEnabled=false override', async () => {
    process.env.ACTIS_LLM_ENABLED = 'true';
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"since": 1700000000000}' }),
    });

    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery, {}, false);
    expect(result.usedLLM).toBe(false);
    expect(result.parsed.since).toBeDefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('respects explicit llmEnabled=true override', async () => {
    delete process.env.ACTIS_LLM_ENABLED;
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ response: '{"since": 1700000000000}' }),
    });

    const result = await parseQueryWithLLMFallback('what changed since Tuesday', parseNaturalQuery, {}, true);
    expect(result.usedLLM).toBe(true);
    expect(result.parsed.since).toBe(1700000000000);
  });
});

describe('llm-query: checkOllamaHealth', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('returns true when Ollama is healthy and model exists', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:latest' }] }),
    });

    const result = await checkOllamaHealth({ baseUrl: 'http://localhost:11434', model: 'llama3.2' });
    expect(result).toBe(true);
  });

  it('returns false when model not found', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'other-model:latest' }] }),
    });

    const result = await checkOllamaHealth({ model: 'llama3.2' });
    expect(result).toBe(false);
  });

  it('returns false on HTTP error', async () => {
    (global.fetch as vi.Mock).mockResolvedValue({ ok: false, status: 500 });

    const result = await checkOllamaHealth();
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    (global.fetch as vi.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await checkOllamaHealth();
    expect(result).toBe(false);
  });

  it('returns false on timeout', async () => {
    (global.fetch as vi.Mock).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 100))
    );

    const result = await checkOllamaHealth();
    expect(result).toBe(false);
  });
});