/**
 * End-to-end verifier. Boots the real gateway (real policy.yaml, real registry)
 * on a random port, then drives every demo scenario exactly as the device and
 * trusted-contact apps do: same rule engine, same signing, same HTTP + SSE.
 *
 * Also exercises the attacks the gateway must refuse, and checks what the
 * attestation does and doesn't contain.
 *
 *   pnpm verify
 */
import type { AddressInfo } from 'node:net';
import {
  deriveDemoKeyPair,
  generateKeyPair,
  paymentBinding,
  randomId,
  randomNonce,
  signAttestation,
  signResolution,
} from '@viraam/crypto';
import { assessSession, type RiskScorer } from '@viraam/intelligence';
import {
  DEMO_IDENTITIES,
  DEMO_SCENARIOS,
  getScenario,
  scenarioSignals,
  type AttestationPayload,
  type DemoScenario,
  type GatewayEvent,
  type HoldBrief,
  type PaymentIntent,
  type PaymentRecord,
  type SignedAttestation,
} from '@viraam/schema';
import { createGateway } from '../src/app';
import { loadPolicy } from '../src/config';

const { device, trustedContact } = DEMO_IDENTITIES;
const deviceKey = deriveDemoKeyPair(device.keySeedLabel);
const contactKey = deriveDemoKeyPair(trustedContact.keySeedLabel);

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) passes++;
  else failures++;
  console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (cond()) return true;
  return cond();
}

async function boot(overrides: (p: ReturnType<typeof loadPolicy>) => void = () => {}) {
  const policy = loadPolicy();
  overrides(policy);
  const gw = createGateway({ policy, log: () => {} });
  const server = gw.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    gw,
    base,
    async stop() {
      gw.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

/** Minimal SSE reader over fetch. */
function subscribe(base: string, channel: string) {
  const events: GatewayEvent[] = [];
  const ctrl = new AbortController();
  (async () => {
    const res = await fetch(`${base}/v1/events?channel=${encodeURIComponent(channel)}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
    }
  })().catch(() => {});
  return {
    events,
    close: () => ctrl.abort(),
    async waitFor<T extends GatewayEvent['type']>(type: T, ms = 3000): Promise<Extract<GatewayEvent, { type: T }>> {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const e = events.find((x) => x.type === type);
        if (e) return e as Extract<GatewayEvent, { type: T }>;
        await sleep(20);
      }
      throw new Error(`timed out waiting for ${type} on ${channel}`);
    },
  };
}

function intentFor(s: DemoScenario, amountPaise = s.amountPaise): PaymentIntent {
  return {
    paymentId: randomId('pay_'),
    payerVpa: device.payerVpa,
    payeeVpa: s.payee.vpa,
    payeeName: s.payee.name,
    amountPaise,
  };
}

/** Exactly what apps/device does when Pay is pressed. */
function attest(
  s: DemoScenario,
  intent: PaymentIntent,
  opts: { advisory?: RiskScorer | null; issuedAt?: number; keyId?: string; privateKey?: string; signalsAmount?: number } = {},
): SignedAttestation {
  const signals = scenarioSignals(s, opts.signalsAmount ?? intent.amountPaise, Date.now());
  const a = assessSession(signals, { advisoryScorer: opts.advisory });
  const payload: AttestationPayload = {
    version: 1,
    deviceId: device.deviceId,
    issuedAt: opts.issuedAt ?? Date.now(),
    nonce: randomNonce(),
    sessionRisk: a.sessionRisk,
    verdict: a.verdict,
    evidence: a.evidence,
    payeeNovelty: a.payeeNovelty,
    amountBand: a.amountBand,
    paymentBinding: paymentBinding(intent),
    scorer: a.scorer,
  };
  return signAttestation(payload, opts.keyId ?? device.keyId, opts.privateKey ?? deviceKey.privateKey);
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
const pay = (base: string, intent: PaymentIntent, attestation: SignedAttestation | null) =>
  post(base, '/v1/payments', { intent, attestation }) as Promise<{ status: number; json: PaymentRecord }>;

async function resolveHold(base: string, brief: HoldBrief, decision: 'APPROVE' | 'DENY', key = contactKey, keyId: string = trustedContact.keyId) {
  const signed = signResolution(
    { version: 1, holdId: brief.holdId, contactId: brief.contactId, decision, issuedAt: Date.now(), nonce: randomNonce() },
    keyId,
    key.privateKey,
  );
  return post(base, `/v1/holds/${brief.holdId}/resolve`, signed);
}

async function runScenarios(label: string, advisory: RiskScorer | null) {
  console.log(`\n== Demo scenarios (${label}) ==`);
  const { base, gw, stop } = await boot((p) => (p.stepUp.coolingSeconds = 1));
  try {
    // 1. Normal payment
    {
      const s = getScenario('normal');
      const intent = intentFor(s);
      const r = await pay(base, intent, attest(s, intent, { advisory }));
      check('#1 Normal payment -> ALLOW, settled', r.json.outcome === 'ALLOW' && r.json.status === 'SETTLED', JSON.stringify(r.json));
      check('#1 no evidence raised', r.json.evidence.length === 0, r.json.evidence.join());
    }

    // 2. Digital arrest -> HOLD -> trusted contact denies
    {
      const s = getScenario('digital-arrest');
      const sub = subscribe(base, `trusted:${trustedContact.contactId}`);
      const dev = subscribe(base, `device:${device.deviceId}`);
      await sub.waitFor('snapshot');
      await dev.waitFor('snapshot');
      const intent = intentFor(s);
      const r = await pay(base, intent, attest(s, intent, { advisory }));
      check('#2 Digital arrest -> HOLD', r.json.outcome === 'HOLD' && r.json.status === 'AWAITING_CONTACT', JSON.stringify(r.json));
      check('#2 matched rule coercion-signature', r.json.matchedRule?.id === 'coercion-signature', r.json.matchedRule?.id);
      check(
        '#2 evidence = call, remote access, first-seen payee, >p99, off-hour',
        ['CALL_ACTIVE_GT_30M', 'REMOTE_ACCESS_SERVICE_ACTIVE', 'PAYEE_FIRST_SEEN', 'AMOUNT_GT_P99', 'OFF_PATTERN_HOUR'].every((c) =>
          r.json.evidence.includes(c as never),
        ),
        r.json.evidence.join(),
      );
      const req = await sub.waitFor('hold.requested');
      check('#2 trusted contact notified over SSE', req.brief.paymentId === intent.paymentId);
      const briefJson = JSON.stringify(req.brief);
      check(
        '#2 trusted brief carries band only: no exact amount, payee name or VPA',
        !briefJson.includes(String(intent.amountPaise)) && !briefJson.includes(s.payee.name) && !briefJson.includes(s.payee.vpa),
        briefJson,
      );
      const forged = await resolveHold(base, req.brief, 'APPROVE', deviceKey, device.keyId);
      check('#2 approval signed with the PAYER\'s key is refused', forged.status === 422 && forged.json.code === 'UNKNOWN_KEY', JSON.stringify(forged.json));
      const d = await resolveHold(base, req.brief, 'DENY');
      check('#2 trusted contact DENY -> DECLINED', d.json.status === 'DECLINED' && d.json.hold?.resolution === 'DENIED', JSON.stringify(d.json));
      check('#2 nothing reached the rail', !gw.rail.ledger.some((l) => l.paymentId === intent.paymentId));
      const sawDeclined = await until(() =>
        dev.events.some((e) => e.type === 'payment.updated' && e.payment.paymentId === intent.paymentId && e.payment.status === 'DECLINED'),
      );
      check('#2 payer\'s device saw the DECLINED update over SSE', sawDeclined);
      const again = await resolveHold(base, req.brief, 'APPROVE');
      check('#2 a resolved hold cannot be re-opened', again.status === 404);
      sub.close();
      dev.close();
    }

    // 3. False positive guard
    {
      const s = getScenario('false-positive-guard');
      const intent = intentFor(s);
      const r = await pay(base, intent, attest(s, intent, { advisory }));
      check('#3 False positive guard -> ALLOW, settled', r.json.outcome === 'ALLOW' && r.json.status === 'SETTLED', JSON.stringify(r.json));
      check('#3 long call IS seen (evidence = CALL_ACTIVE_GT_30M) yet not blocked', r.json.evidence.join() === 'CALL_ACTIVE_GT_30M', r.json.evidence.join());
    }

    // 4. VIRAAM disabled: same inputs as #2, no attestation
    {
      const s = getScenario('viraam-disabled');
      const intent = intentFor(s);
      const r = await pay(base, intent, null);
      check('#4 VIRAAM disabled -> settles unprotected', r.json.outcome === 'UNATTESTED' && r.json.status === 'SETTLED' && !r.json.protected, JSON.stringify(r.json));
      check('#4 the ₹2,00,000 reached the (mock) rail', gw.rail.ledger.some((l) => l.paymentId === intent.paymentId && l.amountPaise === 2_00_000 * 100));
    }

    // 5. Bonus: cooling-off / STEP_UP
    {
      const s = getScenario('cooling-off');
      const intent = intentFor(s);
      const first = attest(s, intent, { advisory });
      const r = await pay(base, intent, first);
      check('#5 Cooling-off -> STEP_UP', r.json.outcome === 'STEP_UP' && r.json.status === 'COOLING', JSON.stringify(r.json));
      const early = await post(base, `/v1/payments/${intent.paymentId}/confirm`, { attestation: attest(s, intent, { advisory }) });
      check('#5 re-confirm before cooling ends is refused (425)', early.status === 425);
      await sleep(1100);
      const ok = await post(base, `/v1/payments/${intent.paymentId}/confirm`, { attestation: attest(s, intent, { advisory }) });
      check('#5 re-confirm after cooling with fresh attestation -> SETTLED', ok.json.status === 'SETTLED' && ok.json.confirmations === 1, JSON.stringify(ok.json));
    }
  } finally {
    await stop();
  }
}

async function runSecurity() {
  console.log('\n== Gateway refuses bad attestations ==');
  const { base, stop } = await boot((p) => (p.stepUp.coolingSeconds = 0));
  const s = getScenario('digital-arrest');
  try {
    const expectReject = async (name: string, intent: PaymentIntent, att: unknown, code: string) => {
      const r = await post(base, '/v1/payments', { intent, attestation: att });
      check(name, r.status === 422 && r.json.status === 'REJECTED' && r.json.rejectReason === code, `${r.status} ${r.json.rejectReason}`);
    };

    let intent = intentFor(s);
    const stranger = generateKeyPair();
    await expectReject('unknown signing key -> UNKNOWN_KEY', intent, attest(s, intent, { keyId: 'key_dev_unknown_01', privateKey: stranger.privateKey }), 'UNKNOWN_KEY');

    intent = intentFor(s);
    await expectReject('enrolled keyId, wrong private key -> BAD_SIGNATURE', intent, attest(s, intent, { privateKey: stranger.privateKey }), 'BAD_SIGNATURE');

    intent = intentFor(s);
    const tampered = attest(s, intent);
    tampered.payload = { ...tampered.payload, evidence: [], sessionRisk: 0, verdict: 'ALLOW' };
    await expectReject('evidence stripped after signing -> BAD_SIGNATURE', intent, tampered, 'BAD_SIGNATURE');

    intent = intentFor(s);
    await expectReject('issued 5 minutes ago -> STALE', intent, attest(s, intent, { issuedAt: Date.now() - 5 * 60_000 }), 'STALE');

    intent = intentFor(s);
    await expectReject('issued 5 minutes in the future -> FROM_FUTURE', intent, attest(s, intent, { issuedAt: Date.now() + 5 * 60_000 }), 'FROM_FUTURE');

    // A clean attestation for a ₹340 payment, replayed onto a ₹2,00,000 payment.
    const small = intentFor(getScenario('normal'));
    const smallAtt = attest(getScenario('normal'), small);
    const big = { ...intentFor(s), paymentId: randomId('pay_') };
    await expectReject('attestation for another payment -> BINDING_MISMATCH', big, smallAtt, 'BINDING_MISMATCH');

    intent = intentFor(s);
    const smuggle = attest(s, intent);
    (smuggle.payload as Record<string, unknown>).callerNumber = '+91-00000-00000';
    await expectReject('extra field in payload (raw-data smuggling) -> MALFORMED', intent, smuggle, 'MALFORMED');

    // Replay: reuse the original attestation (same payment, still fresh) as the STEP_UP re-confirmation.
    const cs = getScenario('cooling-off');
    const ci = intentFor(cs);
    const original = attest(cs, ci);
    await pay(base, ci, original);
    const replay = await post(base, `/v1/payments/${ci.paymentId}/confirm`, { attestation: original });
    check('replayed nonce on re-confirm -> REPLAYED_NONCE', replay.status === 422 && replay.json.rejectReason === 'REPLAYED_NONCE', `${replay.status} ${replay.json.rejectReason}`);

    const dupe = await post(base, '/v1/payments', { intent: ci, attestation: original });
    check('resubmitting a payment id -> 409', dupe.status === 409);
  } finally {
    await stop();
  }

  console.log('\n== Hold expires safely to DENY ==');
  const g2 = await boot((p) => (p.hold.expirySeconds = 1));
  try {
    const intent = intentFor(s);
    const r = await pay(g2.base, intent, attest(s, intent));
    check('held payment starts AWAITING_CONTACT', r.json.status === 'AWAITING_CONTACT');
    await sleep(1300);
    const after = await fetch(`${g2.base}/v1/payments/${intent.paymentId}`).then((x) => x.json() as Promise<PaymentRecord>);
    check('no answer within expiry -> DECLINED (EXPIRED)', after.status === 'DECLINED' && after.hold?.resolution === 'EXPIRED', JSON.stringify(after));
    check('expired hold never reached the rail', !g2.gw.rail.ledger.some((l) => l.paymentId === intent.paymentId));
  } finally {
    await g2.stop();
  }
}

function runPrivacy() {
  console.log('\n== What the attestation contains ==');
  const s = getScenario('digital-arrest');
  const intent = intentFor(s);
  const att = attest(s, intent);
  const allowed = ['version', 'deviceId', 'issuedAt', 'nonce', 'sessionRisk', 'verdict', 'evidence', 'payeeNovelty', 'amountBand', 'paymentBinding', 'scorer'];
  check('payload has exactly the documented fields', JSON.stringify(Object.keys(att.payload).sort()) === JSON.stringify([...allowed].sort()), Object.keys(att.payload).join());
  const wire = JSON.stringify(att);
  const forbidden = [
    s.payee.name,
    s.payee.vpa,
    device.payerVpa,
    String(intent.amountPaise),
    String(s.signals.call.durationSeconds),
    String(s.signals.p99AmountPaise),
  ];
  check('no payee, payer, exact amount, call duration or history on the wire', forbidden.every((f) => !wire.includes(f)), forbidden.filter((f) => wire.includes(f)).join());
}

async function main() {
  console.log('VIRAAM end-to-end verification (offline, synthetic data)');
  runPrivacy();
  await runScenarios('rule engine only: default path', null);

  // The AI module is optional. If packages/intelligence/src/ai has been deleted, this is skipped, not failed.
  // Specifier held in a variable so neither tsc nor tsx requires the module to exist.
  const aiSpecifier = '@viraam/intelligence/ai';
  const ai = (await import(aiSpecifier).catch(() => null)) as { aiModule: { scorer: RiskScorer } } | null;
  if (ai) await runScenarios(`rules + optional model "${ai.aiModule.scorer.id}"`, ai.aiModule.scorer);
  else console.log('\n(optional AI module not present: skipped model-assisted run. Rule engine path verified above.)');

  await runSecurity();

  console.log(`\n${passes} passed, ${failures} failed. Scenarios checked: ${DEMO_SCENARIOS.map((x) => x.number).join(', ')}.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
