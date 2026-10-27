import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DemoTag,
  PaymentIntent,
  amountBandFor,
  type GatewayEvent,
  type HoldBrief,
  type HoldResolution,
  type PaymentRecord,
  type PolicyConfig,
  type Verdict,
} from '@viraam/schema';
import { randomId } from '@viraam/crypto';
import { loadPolicy, loadRegistry, type Registry } from './config';
import { EventBus } from './events';
import { evaluatePolicy } from './policy';
import { MockRail } from './rail';
import { NonceStore, REJECT_MESSAGES, verifyAttestation, verifyResolution } from './verify';

export interface GatewayOptions {
  policy?: PolicyConfig;
  registry?: Registry;
  now?: () => number;
  log?: (line: string) => void;
}

interface Entry {
  intent: PaymentIntent;
  record: PaymentRecord;
}

const SubmissionBody = z
  .object({
    intent: PaymentIntent,
    /** Validated by verifyAttestation, so a malformed attestation is a visible REJECTED decision, not a silent 400. */
    attestation: z.unknown(),
    demo: DemoTag.optional(),
  })
  .strict();

export function createGateway(options: GatewayOptions = {}) {
  const policy = options.policy ?? loadPolicy();
  const registry = options.registry ?? loadRegistry();
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));

  const nonces = new NonceStore(policy.attestation.nonceTtlSeconds * 1000);
  const rail = new MockRail();
  const bus = new EventBus();
  const payments = new Map<string, Entry>();
  const holds = new Map<string, { paymentId: string; timer: NodeJS.Timeout }>();

  const deps = () => ({ registry, policy, nonces, now: now() });

  // ---------- state transitions ----------

  function touch(entry: Entry, patch: Partial<PaymentRecord>): PaymentRecord {
    Object.assign(entry.record, patch, { updatedAt: now() });
    const event: GatewayEvent = { type: 'payment.updated', payment: entry.record };
    bus.publish('console', event);
    if (entry.record.deviceId) bus.publish(`device:${entry.record.deviceId}`, event);
    const r = entry.record;
    log(
      `[${r.outcome.padEnd(10)}] ${r.status.padEnd(16)} ${r.paymentId} ${r.demo?.label ?? r.payeeName}` +
        (r.matchedRule ? `  rule=${r.matchedRule.id}` : '') +
        (r.evidence.length ? `  evidence=${r.evidence.join(',')}` : '') +
        (r.rejectReason ? `  reason=${r.rejectReason}` : ''),
    );
    return entry.record;
  }

  function briefFor(record: PaymentRecord): HoldBrief | null {
    if (!record.hold || !record.payeeNovelty) return null;
    const h = record.hold;
    return {
      holdId: h.holdId,
      paymentId: record.paymentId,
      requesterName: h.requesterName,
      contactId: h.contactId,
      contactName: h.contactName,
      amountBand: record.amountBand,
      payeeNovelty: record.payeeNovelty,
      evidence: record.evidence,
      createdAt: h.createdAt,
      expiresAt: h.expiresAt,
      resolution: h.resolution,
    };
  }

  function settle(entry: Entry, statusDetail: string) {
    const receipt = rail.settle(entry.intent, now());
    return touch(entry, { status: 'SETTLED', rail: receipt, statusDetail, coolingUntil: undefined });
  }

  function endHold(entry: Entry, resolution: HoldResolution) {
    const hold = entry.record.hold;
    if (!hold) return;
    const h = holds.get(hold.holdId);
    if (h) clearTimeout(h.timer);
    holds.delete(hold.holdId);
    hold.resolution = resolution;
    hold.resolvedAt = now();
    const brief = briefFor(entry.record);
    if (brief) bus.publish(`trusted:${hold.contactId}`, { type: 'hold.resolved', brief });
  }

  function startHold(entry: Entry) {
    const deviceId = entry.record.deviceId;
    const enrolment = registry.enrolments.find((e) => e.deviceId === deviceId);
    if (!enrolment) {
      return touch(entry, { status: 'DECLINED', statusDetail: 'Held, but no trusted contact is enrolled. Declined safely.' });
    }
    const createdAt = now();
    const holdId = randomId('hold_', 6);
    const expiresAt = createdAt + policy.hold.expirySeconds * 1000;
    const timer = setTimeout(() => {
      if (entry.record.status !== 'AWAITING_CONTACT') return;
      endHold(entry, 'EXPIRED');
      touch(entry, { status: 'DECLINED', statusDetail: `No response from ${enrolment.trustedContact.displayName} in time. Expired safely to DENY.` });
    }, policy.hold.expirySeconds * 1000);
    timer.unref();
    holds.set(holdId, { paymentId: entry.record.paymentId, timer });

    const record = touch(entry, {
      status: 'AWAITING_CONTACT',
      coolingUntil: undefined,
      statusDetail: `Frozen. Waiting for ${enrolment.trustedContact.displayName} (trusted contact).`,
      hold: {
        holdId,
        contactId: enrolment.trustedContact.contactId,
        contactName: enrolment.trustedContact.displayName,
        requesterName: enrolment.ownerDisplayName,
        createdAt,
        expiresAt,
      },
    });
    const brief = briefFor(record);
    if (brief) bus.publish(`trusted:${brief.contactId}`, { type: 'hold.requested', brief });
    return record;
  }

  function applyOutcome(entry: Entry, outcome: Verdict) {
    if (outcome === 'ALLOW') return settle(entry, entry.record.confirmations > 0 ? 'Re-confirmed after cooling period. Settled.' : 'Settled on mock rail.');
    if (outcome === 'STEP_UP') {
      return touch(entry, {
        status: 'COOLING',
        coolingUntil: now() + policy.stepUp.coolingSeconds * 1000,
        statusDetail: `Cooling period of ${policy.stepUp.coolingSeconds}s, then the payer must re-confirm.`,
      });
    }
    return startHold(entry);
  }

  // ---------- HTTP ----------

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, policy: policy.name, rules: policy.rules.length }));
  app.get('/v1/policy', (_req, res) => res.json(policy));

  app.post('/v1/payments', (req: Request, res: Response) => {
    const body = SubmissionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid payment submission', issues: body.error.issues });
    const { intent, attestation, demo } = body.data;
    if (payments.has(intent.paymentId)) return res.status(409).json({ error: 'Duplicate paymentId' });

    const t = now();
    const record: PaymentRecord = {
      paymentId: intent.paymentId,
      deviceId: null,
      payeeName: intent.payeeName,
      payeeVpa: intent.payeeVpa,
      amountPaise: intent.amountPaise,
      amountBand: amountBandFor(intent.amountPaise),
      status: 'REJECTED',
      outcome: 'REJECTED',
      protected: false,
      evidence: [],
      sessionRisk: null,
      deviceVerdict: null,
      payeeNovelty: null,
      scorer: null,
      matchedRule: null,
      checks: null,
      statusDetail: '',
      confirmations: 0,
      demo,
      createdAt: t,
      updatedAt: t,
    };
    const entry: Entry = { intent, record };
    payments.set(intent.paymentId, entry);

    // Today's world: no situational context reaches the bank at all.
    if (attestation === null || attestation === undefined) {
      if (policy.unattested.outcome === 'REJECT') {
        return res.status(422).json(touch(entry, { statusDetail: 'Rejected: bank requires a VIRAAM attestation.', rejectReason: 'NO_ATTESTATION' }));
      }
      record.outcome = 'UNATTESTED';
      return res.json(settle(entry, 'No attestation. Passed straight to the rail (legacy path).'));
    }

    const v = verifyAttestation(attestation, intent, deps());
    if (!v.ok) {
      return res.status(422).json(
        touch(entry, { checks: v.checks, rejectReason: v.code, statusDetail: `Rejected: ${REJECT_MESSAGES[v.code]}.` }),
      );
    }

    const p = v.payload;
    const decision = evaluatePolicy(policy, {
      evidence: p.evidence,
      sessionRisk: p.sessionRisk,
      deviceVerdict: p.verdict,
      amountBand: p.amountBand,
      payeeNovelty: p.payeeNovelty,
    });
    Object.assign(record, {
      deviceId: p.deviceId,
      protected: true,
      outcome: decision.outcome,
      evidence: p.evidence,
      sessionRisk: p.sessionRisk,
      deviceVerdict: p.verdict,
      payeeNovelty: p.payeeNovelty,
      scorer: p.scorer,
      matchedRule: decision.rule,
      checks: v.checks,
    } satisfies Partial<PaymentRecord>);
    return res.json(applyOutcome(entry, decision.outcome));
  });

  app.get('/v1/payments/:id', (req, res) => {
    const entry = payments.get(req.params.id);
    return entry ? res.json(entry.record) : res.status(404).json({ error: 'Unknown payment' });
  });

  /** STEP_UP re-confirmation: needs the cooling period to have elapsed AND a fresh attestation. */
  app.post('/v1/payments/:id/confirm', (req, res) => {
    const entry = payments.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Unknown payment' });
    if (entry.record.status !== 'COOLING') return res.status(409).json({ error: `Payment is ${entry.record.status}` });
    if (now() < (entry.record.coolingUntil ?? 0)) return res.status(425).json({ error: 'Cooling period not over yet' });

    const v = verifyAttestation(req.body?.attestation, entry.intent, deps());
    if (!v.ok) {
      return res.status(422).json(
        touch(entry, { status: 'REJECTED', outcome: 'REJECTED', checks: v.checks, rejectReason: v.code, statusDetail: `Re-confirmation rejected: ${REJECT_MESSAGES[v.code]}.` }),
      );
    }
    const p = v.payload;
    if (p.deviceId !== entry.record.deviceId) return res.status(403).json({ error: 'Different device' });
    const decision = evaluatePolicy(policy, {
      evidence: p.evidence,
      sessionRisk: p.sessionRisk,
      deviceVerdict: p.verdict,
      amountBand: p.amountBand,
      payeeNovelty: p.payeeNovelty,
    });
    Object.assign(entry.record, {
      evidence: p.evidence,
      sessionRisk: p.sessionRisk,
      deviceVerdict: p.verdict,
      checks: v.checks,
      confirmations: entry.record.confirmations + 1,
    });
    // Things got worse during the pause: escalate. Otherwise the user has paused and re-confirmed: release.
    if (decision.outcome === 'HOLD') {
      Object.assign(entry.record, { outcome: 'HOLD', matchedRule: decision.rule });
      return res.json(startHold(entry));
    }
    return res.json(applyOutcome(entry, 'ALLOW'));
  });

  app.post('/v1/payments/:id/cancel', (req, res) => {
    const entry = payments.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Unknown payment' });
    if (entry.record.status !== 'COOLING' && entry.record.status !== 'AWAITING_CONTACT') {
      return res.status(409).json({ error: `Payment is ${entry.record.status}` });
    }
    endHold(entry, 'CANCELLED_BY_USER');
    return res.json(touch(entry, { status: 'DECLINED', coolingUntil: undefined, statusDetail: 'Cancelled by the payer. Nothing was sent.' }));
  });

  app.get('/v1/holds/:holdId', (req, res) => {
    const h = holds.get(req.params.holdId);
    const entry = h && payments.get(h.paymentId);
    const brief = entry && briefFor(entry.record);
    return brief ? res.json(brief) : res.status(404).json({ error: 'No pending hold' });
  });

  app.post('/v1/holds/:holdId/resolve', (req, res) => {
    const h = holds.get(req.params.holdId);
    const entry = h && payments.get(h.paymentId);
    const hold = entry?.record.hold;
    if (!entry || !hold || entry.record.status !== 'AWAITING_CONTACT') return res.status(404).json({ error: 'No pending hold' });

    const v = verifyResolution(req.body, { holdId: hold.holdId, contactId: hold.contactId }, deps());
    if (!v.ok) return res.status(422).json({ error: REJECT_MESSAGES[v.code], code: v.code, checks: v.checks });

    if (v.payload.decision === 'APPROVE') {
      endHold(entry, 'APPROVED');
      return res.json(settle(entry, `Approved by ${hold.contactName} on their device. Settled.`));
    }
    endHold(entry, 'DENIED');
    return res.json(touch(entry, { status: 'DECLINED', statusDetail: `Denied by ${hold.contactName} on their device. No money moved.` }));
  });

  app.get('/v1/events', (req, res) => {
    const channel = String(req.query.channel ?? '');
    if (channel === 'console') {
      const list = [...payments.values()].map((e) => e.record).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
      return bus.subscribe(req, res, channel, { type: 'snapshot', payments: list });
    }
    const device = /^device:(dev_[a-z0-9]{8,32})$/.exec(channel);
    if (device) return bus.subscribe(req, res, channel, { type: 'snapshot', payments: [] });
    const trusted = /^trusted:(tc_[a-z0-9_]{3,32})$/.exec(channel);
    if (trusted) {
      const pending = [...holds.values()]
        .map((h) => payments.get(h.paymentId))
        .filter((e): e is Entry => !!e && e.record.hold?.contactId === trusted[1])
        .map((e) => briefFor(e.record)!)
        .filter(Boolean);
      return bus.subscribe(req, res, channel, { type: 'snapshot', holds: pending });
    }
    return res.status(400).json({ error: 'channel must be console | device:<id> | trusted:<id>' });
  });

  /** Demo convenience: clear the stream between takes. Nonces are kept, so old attestations still can't be replayed. */
  app.post('/v1/demo/reset', (_req, res) => {
    for (const h of holds.values()) clearTimeout(h.timer);
    holds.clear();
    payments.clear();
    rail.reset();
    bus.publishAll({ type: 'reset' });
    log('[reset] demo state cleared');
    res.json({ ok: true });
  });

  return {
    app,
    policy,
    rail,
    close() {
      for (const h of holds.values()) clearTimeout(h.timer);
      bus.closeAll();
    },
  };
}
