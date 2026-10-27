import { useEffect, useRef } from 'react';
import type { GatewayEvent } from '@viraam/schema';

/** Gateway runs on :4000 of whatever host served this page. Override with VITE_GATEWAY_URL. */
export const GATEWAY: string = import.meta.env.VITE_GATEWAY_URL ?? `${location.protocol}//${location.hostname}:4000`;

export async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(GATEWAY + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

/** Subscribe to one gateway SSE channel. Reconnects automatically (EventSource default). */
export function useGatewayEvents(channel: string, onEvent: (e: GatewayEvent) => void, onStatus?: (live: boolean) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const status = useRef(onStatus);
  status.current = onStatus;
  useEffect(() => {
    const es = new EventSource(`${GATEWAY}/v1/events?channel=${encodeURIComponent(channel)}`);
    es.onopen = () => status.current?.(true);
    es.onerror = () => status.current?.(false);
    es.onmessage = (m) => handler.current(JSON.parse(m.data) as GatewayEvent);
    return () => es.close();
  }, [channel]);
}
