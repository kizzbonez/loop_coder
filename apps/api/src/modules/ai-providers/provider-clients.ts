import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderKind } from '@loop/shared';

/** How long a connection test may take, and no retries: the administrator is waiting. */
export const TEST_TIMEOUT_MS = 10_000;

/** An OpenAI-compatible provider answered with an error status. */
export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * The models a provider offers, which also proves the key works. Anthropic through its own SDK;
 * every other provider through the OpenAI-compatible \`GET /models\`. Requests leave through the
 * egress gateway (HTTPS_PROXY), which only lets configured hosts through.
 */
export async function listModels(provider: { kind: AiProviderKind; baseUrl: string }, apiKey: string): Promise<string[]> {
  if (provider.kind === 'anthropic') {
    const client = new Anthropic({ apiKey, baseURL: provider.baseUrl, timeout: TEST_TIMEOUT_MS, maxRetries: 0 });
    const page = await client.models.list({ limit: 100 });
    return page.data.map((m) => m.id);
  }
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!res.ok) throw new ProviderHttpError(res.status);
  const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
  return (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
}

/** What a failed test means, in plain words, without ever echoing the key or a provider's error body. */
export function explainFailure(error: unknown): { message: string; reachable: boolean } {
  const byStatus = (status: number | undefined): string | null => {
    if (status === 401) return 'The provider rejected the API key (401). Check it and save it again.';
    if (status === 403) return 'The key is valid but not allowed to list models (403). Check its permissions or project.';
    if (status === 404) return 'The provider answered 404: check the base URL.';
    if (status === 429) return 'The provider is reachable but rate-limited the request (429). Try again in a minute.';
    if (status !== undefined && status >= 500) return `The provider had an error (${status}). Try again later.`;
    if (status !== undefined) return `The provider answered ${status}.`;
    return null;
  };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { message: `No answer within ${TEST_TIMEOUT_MS / 1000} seconds.`, reachable: false };
  if (error instanceof Anthropic.APIConnectionError) return { message: unreachable, reachable: false };
  if (error instanceof Anthropic.APIError) return { message: byStatus(error.status) ?? 'The provider returned an error.', reachable: true };
  if (error instanceof ProviderHttpError) return { message: byStatus(error.status)!, reachable: true };
  if (error instanceof Error && error.name === 'TimeoutError') return { message: `No answer within ${TEST_TIMEOUT_MS / 1000} seconds.`, reachable: false };
  return { message: unreachable, reachable: false };
}

const unreachable =
  'Could not reach the provider. Check the base URL; Loop Coder can only reach the hosts of enabled providers through its egress gateway.';
