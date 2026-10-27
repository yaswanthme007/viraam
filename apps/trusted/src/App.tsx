import { useEffect, useState } from 'react';
import { deriveDemoKeyPair, randomNonce, signResolution } from '@viraam/crypto';
import { defaultCopy } from '@viraam/intelligence';
import { AMOUNT_BAND_LABEL, DEMO_IDENTITIES, PAYEE_NOVELTY_LABEL, type HoldBrief } from '@viraam/schema';
import { api, useGatewayEvents } from './gateway';

const { trustedContact } = DEMO_IDENTITIES;
/** DEMO key, derived from a public label. A real trusted-contact key lives in that person's phone keystore. */
const contactKey = deriveDemoKeyPair(trustedContact.keySeedLabel);

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function App() {
  const [brief, setBrief] = useState<HoldBrief | null>(null);
  const [mine, setMine] = useState<'APPROVE' | 'DENY' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const now = useNow();

  useGatewayEvents(
    `trusted:${trustedContact.contactId}`,
    (e) => {
      if (e.type === 'snapshot' && e.holds?.length) {
        setBrief(e.holds[e.holds.length - 1]!);
        setMine(null);
      }
      if (e.type === 'hold.requested') {
        setBrief(e.brief);
        setMine(null);
        setError(null);
      }
      if (e.type === 'hold.resolved') setBrief((b) => (b && b.holdId === e.brief.holdId ? e.brief : b));
      if (e.type === 'reset') {
        setBrief(null);
        setMine(null);
      }
    },
    setLive,
  );

  async function respond(decision: 'APPROVE' | 'DENY') {
    if (!brief) return;
    setBusy(true);
    setError(null);
    const signed = signResolution(
      { version: 1, holdId: brief.holdId, contactId: brief.contactId, decision, issuedAt: Date.now(), nonce: randomNonce() },
      trustedContact.keyId,
      contactKey.privateKey,
    );
    try {
      const r = await api<{ error?: string }>(`/v1/holds/${brief.holdId}/resolve`, signed);
      if (r.status >= 400) setError(r.data.error ?? `Gateway returned ${r.status}`);
      else setMine(decision);
    } catch {
      setError('Cannot reach the gateway.');
    }
    setBusy(false);
  }

  const pending = brief && !brief.resolution;
  const copy = brief
    ? defaultCopy.forTrustedContact({
        requesterName: brief.requesterName,
        evidence: brief.evidence,
        amountBand: brief.amountBand,
        payeeNovelty: brief.payeeNovelty,
      })
    : null;

  return (
    <div className="page">
      <header className="caption">
        <strong>Trusted contact's phone</strong>
        <span>
          {trustedContact.name} (synthetic) · signs replies with their own key ·{' '}
          <span className={live ? 'ok' : 'down'}>{live ? 'connected' : 'gateway offline'}</span>
        </span>
      </header>

      <div className="phone">
        <div className="screen">
          <div className="statusbar">
            <span>{new Date(now).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
            <span className="vbadge">❚❚ VIRAAM</span>
          </div>

          {!brief && (
            <div className="idle" data-testid="idle">
              <div className="idle-mark">❚❚</div>
              <h1>All quiet</h1>
              <p>
                You're {DEMO_IDENTITIES.device.ownerName}'s trusted contact. If one of their payments looks like it's
                happening under pressure, it pauses and you'll be asked here.
              </p>
            </div>
          )}

          {brief && copy && pending && (
            <div className="request" data-testid="request">
              <div className="kicker">Needs your answer · {mmss(brief.expiresAt - now)}</div>
              <h1>{copy.headline}</h1>
              <div className="facts">
                <div>
                  <span>Amount</span>
                  <strong>{AMOUNT_BAND_LABEL[brief.amountBand]}</strong>
                </div>
                <div>
                  <span>Recipient</span>
                  <strong>{PAYEE_NOVELTY_LABEL[brief.payeeNovelty]}</strong>
                </div>
              </div>
              <h2>Why it paused</h2>
              <ul className="reasons">
                {copy.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="advice">{copy.body}</p>
              <div className="spacer" />
              <button className="btn deny" onClick={() => respond('DENY')} disabled={busy} data-testid="deny">
                Stop this payment
              </button>
              <button className="btn approve" onClick={() => respond('APPROVE')} disabled={busy} data-testid="approve">
                I've checked. Let it go through
              </button>
              <p className="fine">If you don't answer, it's stopped automatically.</p>
              {error && <p className="err">{error}</p>}
            </div>
          )}

          {brief && !pending && (
            <div className="done" data-testid="resolved">
              <div className={'done-mark ' + (brief.resolution === 'APPROVED' ? 'go' : 'stop')}>
                {brief.resolution === 'APPROVED' ? '→' : '✓'}
              </div>
              <h1>
                {brief.resolution === 'DENIED' && 'You stopped it.'}
                {brief.resolution === 'APPROVED' && 'You let it through.'}
                {brief.resolution === 'EXPIRED' && 'Stopped automatically.'}
                {brief.resolution === 'CANCELLED_BY_USER' && `${brief.requesterName} cancelled it.`}
              </h1>
              <p>
                {brief.resolution === 'APPROVED'
                  ? `The payment has been released.`
                  : `${brief.requesterName}'s money stays in their account.`}
              </p>
              {brief.resolution !== 'APPROVED' && (
                <p className="advice">Give {brief.requesterName} a call on their usual number and check they're okay.</p>
              )}
              {mine && <p className="fine">Your reply was signed on this phone and verified by the bank.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
