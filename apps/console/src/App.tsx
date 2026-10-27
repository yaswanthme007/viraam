import { useEffect, useState } from 'react';
import {
  AMOUNT_BAND_LABEL,
  EVIDENCE_CATALOG,
  formatRupees,
  type PaymentRecord,
  type PolicyConfig,
  type VerificationChecks,
} from '@viraam/schema';
import { api, useGatewayEvents } from './gateway';

const OUTCOME_LABEL: Record<PaymentRecord['outcome'], string> = {
  ALLOW: 'ALLOW',
  STEP_UP: 'STEP UP',
  HOLD: 'HOLD',
  UNATTESTED: 'UNPROTECTED',
  REJECTED: 'REJECTED',
};

const CHECK_LABEL: Record<keyof VerificationChecks, string> = {
  schema: 'Schema',
  knownKey: 'Enrolled key',
  signature: 'Signature',
  fresh: 'Fresh',
  binding: 'Bound to payment',
  nonceUnused: 'Nonce unused',
};

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function App() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [live, setLive] = useState(false);
  const now = useNow();

  useEffect(() => {
    api<PolicyConfig>('/v1/policy').then((r) => setPolicy(r.data)).catch(() => {});
  }, [live]);

  useGatewayEvents(
    'console',
    (e) => {
      if (e.type === 'snapshot') setPayments(e.payments ?? []);
      if (e.type === 'reset') setPayments([]);
      if (e.type === 'payment.updated') {
        setPayments((list) => {
          const rest = list.filter((p) => p.paymentId !== e.payment.paymentId);
          return [e.payment, ...rest].sort((a, b) => b.createdAt - a.createdAt);
        });
      }
    },
    setLive,
  );

  const count = (pred: (p: PaymentRecord) => boolean) => payments.filter(pred).length;

  return (
    <div className="console">
      <header className="top">
        <div className="title">
          <span className="mark">❚❚</span>
          <div>
            <h1>VIRAAM decision stream</h1>
            <p>
              Bank operations · {policy ? `policy "${policy.name}" v${policy.version}, ${policy.rules.length} rules` : 'loading policy…'} ·{' '}
              <span className={live ? 'live' : 'down'}>{live ? 'LIVE' : 'OFFLINE'}</span>
            </p>
          </div>
        </div>
        <div className="stats">
          <Stat label="Allowed" n={count((p) => p.outcome === 'ALLOW')} tone="allow" />
          <Stat label="Stepped up" n={count((p) => p.outcome === 'STEP_UP')} tone="step" />
          <Stat label="Held" n={count((p) => p.outcome === 'HOLD')} tone="hold" />
          <Stat label="Unprotected" n={count((p) => p.outcome === 'UNATTESTED')} tone="unprot" />
          <button className="reset" onClick={() => api('/v1/demo/reset', {})}>
            Clear
          </button>
        </div>
      </header>

      {payments.length === 0 && (
        <div className="empty">
          <p>Waiting for payments.</p>
          <p className="sub">Each card shows the verdict, the evidence codes that drove it, and the policy rule that matched. No personal data reaches this screen beyond the payment instruction itself.</p>
        </div>
      )}

      <ol className="stream">
        {payments.map((p) => (
          <Card key={p.paymentId} p={p} now={now} />
        ))}
      </ol>
    </div>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div className={`stat ${tone}`}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

function Card({ p, now }: { p: PaymentRecord; now: number }) {
  const tone = p.outcome.toLowerCase();
  const time = new Date(p.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const holdLeft = p.status === 'AWAITING_CONTACT' && p.hold ? Math.max(0, Math.ceil((p.hold.expiresAt - now) / 1000)) : null;
  const coolLeft = p.status === 'COOLING' && p.coolingUntil ? Math.max(0, Math.ceil((p.coolingUntil - now) / 1000)) : null;

  return (
    <li className={`card ${tone}`} data-testid="decision-card" data-outcome={p.outcome} data-status={p.status}>
      <div className="verdict">
        <span className="outcome">{OUTCOME_LABEL[p.outcome]}</span>
        <span className="time">{time}</span>
      </div>
      <div className="body">
        <div className="headline">
          <span className="label">{p.demo?.label ?? p.payeeName}</span>
          <span className="amount">
            {formatRupees(p.amountPaise)} <small>{AMOUNT_BAND_LABEL[p.amountBand]}</small>
          </span>
        </div>

        <div className={`status s-${p.status}`}>
          <span className="status-name">{p.status.replace('_', ' ')}</span>
          <span>{p.statusDetail}</span>
          {holdLeft !== null && <span className="timer">{holdLeft}s</span>}
          {coolLeft !== null && <span className="timer">{coolLeft}s</span>}
          {p.rail && <span className="rrn">{p.rail.rrn}</span>}
        </div>

        {!p.protected && p.outcome === 'UNATTESTED' && (
          <div className="blind">No attestation. The bank had no situational context for this payment.</div>
        )}

        {p.evidence.length > 0 && (
          <div className="evidence">
            {p.evidence.map((c) => (
              <span className="code" key={c} title={EVIDENCE_CATALOG[c].meaning}>
                <b>{c}</b>
                <i>{EVIDENCE_CATALOG[c].label}</i>
              </span>
            ))}
          </div>
        )}
        {p.protected && p.evidence.length === 0 && <div className="evidence"><span className="code none"><b>NO EVIDENCE CODES</b><i>Nothing situational to flag</i></span></div>}

        <div className="meta">
          {p.matchedRule ? (
            <span>
              Rule <b>{p.matchedRule.id}</b>
            </span>
          ) : p.protected ? (
            <span>
              Rule <b>default</b>
            </span>
          ) : null}
          {p.sessionRisk !== null && (
            <span>
              Session risk <b>{p.sessionRisk}</b>
            </span>
          )}
          {p.deviceVerdict && (
            <span>
              Device said <b>{p.deviceVerdict.replace('_', ' ')}</b>
            </span>
          )}
          {p.scorer && (
            <span>
              Scorer <b>{p.scorer}</b>
            </span>
          )}
        </div>

        {p.checks && (
          <div className="checks">
            {(Object.keys(CHECK_LABEL) as Array<keyof VerificationChecks>).map((k) => (
              <span key={k} className={`check ${p.checks![k]}`}>
                {p.checks![k] === 'pass' ? '✓' : p.checks![k] === 'fail' ? '✕' : '–'} {CHECK_LABEL[k]}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
