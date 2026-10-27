import type { Request, Response } from 'express';
import type { GatewayEvent } from '@viraam/schema';

/**
 * Server-Sent Events, split into channels:
 *   console              bank operations: every payment record
 *   device:<deviceId>    the payer's phone: its own payments only
 *   trusted:<contactId>  a trusted contact: hold briefs addressed to them only
 */
export class EventBus {
  private clients = new Map<string, Set<Response>>();

  subscribe(req: Request, res: Response, channel: string, initial?: GatewayEvent): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    if (initial) res.write(`data: ${JSON.stringify(initial)}\n\n`);

    let set = this.clients.get(channel);
    if (!set) this.clients.set(channel, (set = new Set()));
    set.add(res);

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      set!.delete(res);
    });
  }

  publish(channel: string, event: GatewayEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients.get(channel) ?? []) res.write(data);
  }

  publishAll(event: GatewayEvent): void {
    for (const channel of this.clients.keys()) this.publish(channel, event);
  }

  closeAll(): void {
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
