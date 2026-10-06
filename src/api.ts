import { z } from 'zod';
import type { SearchEvent, ServiceConfig } from '../shared/types';

export async function getConfig(signal: AbortSignal): Promise<ServiceConfig> {
  const response = await fetch('/api/config', { signal });
  if (!response.ok) throw new Error('Configuration unavailable');
  return z
    .object({
      agent: z.boolean(),
      model: z.string(),
      decisionModel: z.string(),
      openalexKey: z.boolean(),
      accessProtected: z.boolean(),
      sciHubEnabled: z.boolean().default(false),
    })
    .parse(await response.json());
}

export async function streamSearch(
  input: unknown,
  token: string,
  signal: AbortSignal,
  onEvent: (event: SearchEvent) => void,
): Promise<void> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const parsed = z.object({ error: z.string() }).safeParse(data);
    throw new Error(
      parsed.success
        ? parsed.data.error
        : `Search failed (${response.status}).`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error('Your browser could not read the search response.');
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as SearchEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'result') complete = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    consume(buffer);
    if (!complete)
      throw new Error('The search connection ended early. Please try again.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
