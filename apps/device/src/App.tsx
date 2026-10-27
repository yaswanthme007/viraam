import { useEffect, useRef, useState } from 'react';
import { deriveDemoKeyPair, paymentBinding, randomId, randomNonce, signAttestation } from '@viraam/crypto';
import { assessSession, defaultCopy, type InterventionCopyGenerator, type SessionAssessment } from '@viraam/intelligence';
import {
  DEMO_IDENTITIES,
  DEMO_SCENARIOS,
  EVIDENCE_CATALOG,
  formatRupees,
  getScenario,
  scenarioSignals,
  type AttestationPayload,
  type DemoScenario,
  type DeviceSignals,
  type PaymentIntent,
  type PaymentRecord,
  type SignedAttestation,
} from '@viraam/schema';
import { SimulatedDeviceSignalCollector } from './collector';
import { api, useGatewayEvents } from './gateway';
import { loadAiModule, type AiModule } from './intelligence';

const { device, trustedContact } = DEMO_IDENTITIES;
const deviceKey = deriveDemoKeyPair(device.keySeedLabel);

type Phase = 'compose' | 'checking' | 'result';
type Sent = { kind: 'attestation'; value: SignedAttestation } | { kind: 'none' };

function newer(a: PaymentRecord | null, b: PaymentRecord): PaymentRecord {
  return a && a.paymentId === b.paymentId && a.updatedAt > b.updatedAt ? a : b;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function App() {
  const [scenarioId, setScenarioId] = useState(DEMO_SCENARIOS[0]!.id);
  const scenario = getScenario(scenarioId);
  const [viraam, setViraam] = useState(true);
  const [ai, setAi] = useState<AiModule | null>(null);
  const [useModel, setUseModel] = useState(false);
  const [phase, setPhase] = useState<Phase>('compose');
  const [record, setRecord] = useState<PaymentRecord | null>(null);
  const [signals, setSignals] = useState<DeviceSignals | null>(null);
  const [assessment, setAssessment] = useState<SessionAssessment | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const paymentId = useRef<string | null>(null);

  useEffect(() => {
    loadAiModule().then(setAi);
  }, []);

  useGatewayEvents(
    `device:${device.deviceId}`,
    (e) => {
      if (e.type === 'payment.updated' && e.payment.paymentId === paymentId.current) setRecord((r) => newer(r, e.payment));
      if (e.type === 'reset') resetPhone();
    },
    setLive,
  );

  function resetPhone() {
    paymentId.current = null;
    setPhase('compose');
    setRecord(null);
    setSignals(null);
    setAssessment(null);
    setSent(null);
    setError(null);
    setBusy(false);
  }

  function selectScenario(s: DemoScenario) {
    setScenarioId(s.id);
    setViraam(s.viraamEnabled);
    resetPhone();
  }

  async function attestFor(intent: PaymentIntent): Promise<SignedAttestation> {
    const collector = new SimulatedDeviceSignalCollector(scenario);
    const sig = await collector.collect({ payeeVpa: intent.payeeVpa, amountPaise: intent.amountPaise });
    const a = assessSession(sig, { advisoryScorer: useModel && ai ? ai.scorer : null });
    const payload: AttestationPayload = {
      version: 1,
      deviceId: device.deviceId,
      issuedAt: Date.now(),
      nonce: randomNonce(),
      sessionRisk: a.sessionRisk,
      verdict: a.verdict,
      evidence: a.evidence,
      payeeNovelty: a.payeeNovelty,
      amountBand: a.amountBand,
      paymentBinding: paymentBinding(intent),
      scorer: a.scorer,
    };
    const signed = signAttestation(payload, device.keyId, deviceKey.privateKey);
    // The raw snapshot is shown in the demo panel and then dropped. Only `signed` goes on the wire.
    setSignals(sig);
    setAssessment(a);
    setSent({ kind: 'attestation', value: signed });
    return signed;
  }

  async function pay() {
    const intent: PaymentIntent = {
      paymentId: randomId('pay_'),
      payerVpa: device.payerVpa,
      payeeVpa: scenario.payee.vpa,
      payeeName: scenario.payee.name,
      amountPaise: scenario.amountPaise,
    };
    paymentId.current = intent.paymentId;
    setPhase('checking');
    setError(null);
    let attestation: SignedAttestation | null = null;
    if (viraam) attestation = await attestFor(intent);
    else {
      setSignals(null);
      setAssessment(null);
      setSent({ kind: 'none' });
    }
    await new Promise((r) => setTimeout(r, 700)); // let the "checking" state register on video
    try {
      const r = await api<PaymentRecord & { error?: string }>('/v1/payments', {
        intent,
        attestation,
        demo: { scenarioId: scenario.id, label: `#${scenario.number} · ${scenario.title}` },
      });
      if (r.data.paymentId) setRecord((prev) => newer(prev, r.data));
      else setError(r.data.error ?? `Gateway returned ${r.status}`);
    } catch {
      setError('Cannot reach the gateway on :4000. Is `pnpm dev` running?');
    }
    setPhase('result');
  }

  async function confirmAfterCooling() {
    if (!record) return;
    setBusy(true);
    const intent: PaymentIntent = {
      paymentId: record.paymentId,
      payerVpa: device.payerVpa,
      payeeVpa: record.payeeVpa,
      payeeName: record.payeeName,
      amountPaise: record.amountPaise,
    };
    const attestation = await attestFor(intent); // fresh signals, fresh nonce
    const r = await api<PaymentRecord & { error?: string }>(`/v1/payments/${record.paymentId}/confirm`, { attestation });
    if (r.data.paymentId) setRecord((prev) => newer(prev, r.data));
    else setError(r.data.error ?? `Gateway returned ${r.status}`);
    setBusy(false);
  }

  async function cancel() {
    if (!record) return;
    setBusy(true);
    const r = await api<PaymentRecord>(`/v1/payments/${record.paymentId}/cancel`, {});
    if (r.data.paymentId) setRecord((prev) => newer(prev, r.data));
    setBusy(false);
  }

  const previewSignals = signals ?? scenarioSignals(scenario, scenario.amountPaise, Date.now());

  return (
    <div className="layout">
      <aside className="panel controls">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
          </span>
          <div>
            <div className="brand-name">VIRAAM</div>
            <div className="brand-sub">Payer's phone (simulated)</div>
          </div>
        </div>

        <h2>Demo scenarios</h2>
        <div className="scenarios">
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={'scenario' + (s.id === scenarioId ? ' active' : '')}
              onClick={() => selectScenario(s)}
              data-testid={`scenario-${s.id}`}
            >
              <span className="scenario-num">{s.number}</span>
              <span className="scenario-text">
                <strong>{s.title}</strong>
                <span>{s.tagline}</span>
              </span>
              <span className={`expect expect-${s.expected}`}>{s.expected === 'UNPROTECTED' ? 'NO LAYER' : s.expected.replace('_', ' ')}</span>
            </button>
          ))}
        </div>

        <label className="switch-row">
          <span>
            <strong>VIRAAM layer</strong>
            <small>{viraam ? 'On: attestation signed and sent' : 'Off: payment goes straight to the rail'}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={viraam}
            onChange={(e) => {
              setViraam(e.target.checked);
              resetPhone();
            }}
            data-testid="viraam-toggle"
          />
        </label>

        {ai && (
          <label className="switch-row">
            <span>
              <strong>Optional model scorer</strong>
              <small>{useModel ? `Rules + ${ai.scorer.id} (can only raise risk)` : 'Off: deterministic rule engine only'}</small>
            </span>
            <input type="checkbox" role="switch" checked={useModel} onChange={(e) => setUseModel(e.target.checked)} />
          </label>
        )}

        <div className={'conn ' + (live ? 'ok' : 'down')}>{live ? 'Gateway connected' : 'Gateway offline: run pnpm dev'}</div>
      </aside>

      <main className="stage">
        <Phone scenario={scenario} viraam={viraam}>
          {phase === 'compose' && <Compose scenario={scenario} viraam={viraam} onPay={pay} />}
          {phase === 'checking' && <Checking viraam={viraam} />}
          {phase === 'result' && error && <ErrorScreen message={error} onBack={resetPhone} />}
          {phase === 'result' && !error && record && (
            <Result record={record} signals={previewSignals} copyGen={useModel && ai ? ai.copy : defaultCopy} busy={busy} onConfirm={confirmAfterCooling} onCancel={cancel} onDone={resetPhone} />
          )}
        </Phone>
      </main>

      <aside className="panel data">
        <h2>
          Stayed on this phone <span className="tag sim">SIMULATED SENSORS</span>
        </h2>
        <p className="story">{scenario.story}</p>
        <SignalList s={previewSignals} />

        <h2>Sent to the bank</h2>
        {!sent && <p className="muted">Nothing yet. Press Pay on the phone.</p>}
        {sent?.kind === 'none' && (
          <div className="unprotected">
            <strong>No attestation.</strong> Without VIRAAM the bank receives only the payment instruction. It has no idea
            Asha is on a 47-minute call with someone controlling their screen.
          </div>
        )}
        {sent?.kind === 'attestation' && assessment && (
          <>
            <div className="evidence">
              {sent.value.payload.evidence.length === 0 && <span className="chip calm">No evidence codes</span>}
              {sent.value.payload.evidence.map((c) => (
                <span className="chip" key={c} title={EVIDENCE_CATALOG[c].meaning}>
                  {c}
                </span>
              ))}
            </div>
            <div className="kv">
              <span>Session risk</span>
              <strong>{sent.value.payload.sessionRisk}/100</strong>
              <span>Device verdict</span>
              <strong>{sent.value.payload.verdict.replace('_', ' ')}</strong>
              <span>Scorer</span>
              <strong>{sent.value.payload.scorer}</strong>
            </div>
            <details>
              <summary>Signed envelope (Ed25519)</summary>
              <pre>{JSON.stringify(sent.value, null, 2)}</pre>
            </details>
          </>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- phone chrome

function Phone({ scenario, viraam, children }: { scenario: DemoScenario; viraam: boolean; children: React.ReactNode }) {
  const t = scenario.signals.localTime;
  const call = scenario.signals.call;
  return (
    <div className="phone" aria-label="Simulated phone">
      <div className="screen">
        <div className="statusbar">
          <span className="time">
            {t.hour % 12 || 12}:{String(t.minute).padStart(2, '0')}
          </span>
          <span className="indicators">
            {call.active && (
              <span className="pill call">
                ● On call {Math.floor(call.durationSeconds / 60)}:{String(call.durationSeconds % 60).padStart(2, '0')}
              </span>
            )}
            {scenario.signals.remoteAccessServiceActive && <span className="pill remote">⧉ Screen control</span>}
            {!viraam && <span className="pill off">VIRAAM off</span>}
          </span>
        </div>
        <div className="screen-body">{children}</div>
      </div>
    </div>
  );
}

function Compose({ scenario, viraam, onPay }: { scenario: DemoScenario; viraam: boolean; onPay: () => void }) {
  return (
    <div className="compose">
      <div className="appbar">MockPay · Send money</div>
      <div className="payee">
        <div className="avatar">{scenario.payee.name[0]}</div>
        <div className="payee-name">{scenario.payee.name}</div>
        <div className="payee-vpa">{scenario.payee.vpa}</div>
      </div>
      <div className="amount" data-testid="amount">
        {formatRupees(scenario.amountPaise)}
      </div>
      <div className="from">From {device.payerVpa}</div>
      <div className="spacer" />
      <div className={'shield ' + (viraam ? 'on' : 'off')}>
        {viraam ? '🛡 Protected by VIRAAM' : 'No VIRAAM protection on this phone'}
      </div>
      <button className="btn primary big" onClick={onPay} data-testid="pay">
        Pay {formatRupees(scenario.amountPaise)}
      </button>
    </div>
  );
}

function Checking({ viraam }: { viraam: boolean }) {
  return (
    <div className="center-screen">
      <div className="spinner" />
      <p>{viraam ? 'Checking the situation on this phone…' : 'Sending…'}</p>
    </div>
  );
}

function ErrorScreen({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="center-screen">
      <p className="err">{message}</p>
      <button className="btn" onClick={onBack}>
        Back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- outcomes

function Result(props: {
  record: PaymentRecord;
  signals: DeviceSignals;
  copyGen: InterventionCopyGenerator;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { record } = props;
  const now = useNow(record.status === 'COOLING' || record.status === 'AWAITING_CONTACT');
  const copy = (verdict: 'HOLD' | 'STEP_UP') =>
    props.copyGen.forDevice({
      verdict,
      evidence: record.evidence,
      signals: props.signals,
      contactName: record.hold?.contactName ?? trustedContact.name,
      coolingSeconds: record.coolingUntil ? Math.round((record.coolingUntil - record.createdAt) / 1000) : undefined,
    });

  if (record.status === 'SETTLED') {
    return (
      <div className="center-screen success" data-testid="screen-settled">
        <div className="tick">✓</div>
        <div className="big-amount">{formatRupees(record.amountPaise)} sent</div>
        <div>to {record.payeeName}</div>
        {record.hold?.resolution === 'APPROVED' && <div className="note">Approved by {record.hold.contactName}</div>}
        {record.confirmations > 0 && <div className="note">Confirmed after a pause</div>}
        <div className="ref">Ref {record.rail?.rrn}</div>
        <div className="fine">Mock rail. No real money moved.</div>
        <button className="btn" onClick={props.onDone}>
          Done
        </button>
      </div>
    );
  }

  if (record.status === 'AWAITING_CONTACT' && record.hold) {
    const c = copy('HOLD');
    return (
      <div className="overlay" data-testid="screen-hold">
        <div className="overlay-brand">❚❚ VIRAAM</div>
        <h1>{c.headline}</h1>
        <p className="lead">{c.body}</p>
        <ul className="reasons">
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {c.fact && <div className="fact">{c.fact}</div>}
        <div className="waiting">
          <span className="pulse" />
          <span>
            Waiting for <strong>{record.hold.contactName}</strong>
          </span>
          <span className="count">{mmss(record.hold.expiresAt - now)}</span>
        </div>
        <button className="btn ghost" onClick={props.onCancel} disabled={props.busy}>
          Cancel this payment
        </button>
      </div>
    );
  }

  if (record.status === 'COOLING') {
    const c = copy('STEP_UP');
    const left = (record.coolingUntil ?? 0) - now;
    return (
      <div className="overlay cooling" data-testid="screen-cooling">
        <div className="overlay-brand">❚❚ VIRAAM</div>
        <h1>{c.headline}</h1>
        <div className="ring">{left > 0 ? Math.ceil(left / 1000) : '✓'}</div>
        <p className="lead">{c.body}</p>
        <ul className="reasons">
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="spacer" />
        <button className="btn light big" onClick={props.onCancel} disabled={props.busy}>
          Cancel payment
        </button>
        <button className="btn ghost" onClick={props.onConfirm} disabled={left > 0 || props.busy} data-testid="confirm">
          {left > 0 ? `Pay anyway in ${Math.ceil(left / 1000)}s` : `Yes, pay ${formatRupees(record.amountPaise)}`}
        </button>
      </div>
    );
  }

  if (record.status === 'DECLINED') {
    const res = record.hold?.resolution;
    const title =
      res === 'DENIED'
        ? `${record.hold!.contactName} stopped this payment.`
        : res === 'EXPIRED'
          ? 'No answer, so we stopped it.'
          : 'Payment cancelled.';
    return (
      <div className="center-screen safe" data-testid="screen-declined">
        <div className="tick safe">✓</div>
        <h1>{title}</h1>
        <div className="big-amount">{formatRupees(record.amountPaise)}</div>
        <p>is still in your account. Nothing was sent.</p>
        {record.evidence.includes('CALL_ACTIVE_GT_30M') && (
          <p className="calm-note">If someone is still on the line, you can hang up. Call {record.hold?.contactName ?? 'someone you trust'} or 1930 (cyber-crime helpline).</p>
        )}
        <button className="btn" onClick={props.onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="center-screen" data-testid="screen-rejected">
      <h1>Payment not accepted</h1>
      <p>{record.statusDetail}</p>
      <button className="btn" onClick={props.onDone}>
        Back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- data panel

function SignalList({ s }: { s: DeviceSignals }) {
  const rows: Array<[string, string, boolean]> = [
    ['Call', s.call.active ? `Active, ${Math.floor(s.call.durationSeconds / 60)} min` : 'None', s.call.active && s.call.durationSeconds > 1800],
    ['Remote-control service', s.remoteAccessServiceActive ? 'Running' : 'None', s.remoteAccessServiceActive],
    ['Screen sharing', s.screenShareActive ? 'Active' : 'No', s.screenShareActive],
    ['Sideloaded app', s.sideloadedAppInstalledHoursAgo === null ? 'None' : `${s.sideloadedAppInstalledHoursAgo} h ago`, s.sideloadedAppInstalledHoursAgo !== null],
    ['Payments to this payee', String(s.payeeHistory.previousPayments), s.payeeHistory.previousPayments === 0],
    ['Amount vs. own p99', `${formatRupees(s.amountStats.amountPaise)} vs ${formatRupees(s.amountStats.p99AmountPaise)}`, s.amountStats.amountPaise > s.amountStats.p99AmountPaise],
    ['Local time', `${String(s.localTime.hour).padStart(2, '0')}:${String(s.localTime.minute).padStart(2, '0')} (usual ${s.usualActiveHours.start}:00–${s.usualActiveHours.end}:00)`, s.localTime.hour < s.usualActiveHours.start || s.localTime.hour >= s.usualActiveHours.end],
    ['App switches / min', String(s.appSwitchesLast60s), s.appSwitchesLast60s >= 8],
  ];
  return (
    <div className="signals">
      {rows.map(([k, v, hot]) => (
        <div className={'signal' + (hot ? ' hot' : '')} key={k}>
          <span>{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}
