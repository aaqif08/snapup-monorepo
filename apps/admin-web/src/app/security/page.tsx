'use client';

import { useSecurityStore } from '@/store/useSecurityStore';

const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-muted/10 text-muted',
  medium: 'bg-warning/10 text-warning',
  high: 'bg-danger/10 text-danger',
  critical: 'bg-danger/20 text-danger',
};

export default function SecurityPage() {
  const { anomalies, securityFlags, resolveAnomaly, reviewSecurityFlag } = useSecurityStore();

  const openAnomalies = anomalies.filter((a) => a.status === 'open' || a.status === 'under_review');
  const resolvedAnomalies = anomalies.filter(
    (a) => a.status !== 'open' && a.status !== 'under_review'
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Security &amp; Anomalies</h1>
      <p className="mb-6 text-sm text-muted">
        Kiosk weight mismatches and ML-flagged behavior from store cameras.
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
          Open Checkout Anomalies ({openAnomalies.length})
        </h2>
        {openAnomalies.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            No open anomalies right now.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {openAnomalies.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-3 border-b border-border p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-bold text-ink">
                    {a.customerLabel} · <span className="font-normal text-muted">{a.sessionId}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {a.type.replace(/_/g, ' ')} — expected {a.expectedWeightGrams}g, measured{' '}
                    {a.measuredWeightGrams}g (
                    <span className={a.deltaGrams > 0 ? 'font-bold text-danger' : 'font-bold text-ink'}>
                      {a.deltaGrams > 0 ? '+' : ''}
                      {a.deltaGrams}g
                    </span>
                    )
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveAnomaly(a.id, 'resolved_legitimate')}
                    className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10"
                  >
                    Mark Legitimate
                  </button>
                  <button
                    onClick={() => resolveAnomaly(a.id, 'resolved_billed')}
                    className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/10"
                  >
                    Bill Difference
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
          ML Security Flags
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {securityFlags.map((flag) => (
            <div
              key={flag.id}
              className="flex flex-col gap-3 border-b border-border p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${SEVERITY_STYLES[flag.severity]}`}
                  >
                    {flag.severity}
                  </span>
                  <p className="font-bold text-ink">{flag.behaviorLabel.replace(/_/g, ' ')}</p>
                </div>
                <p className="text-xs text-muted">
                  {flag.cameraZone} · {flag.customerLabel} · {Math.round(flag.confidenceScore * 100)}%
                  confidence
                </p>
              </div>
              <div className="flex gap-2">
                {flag.status === 'new' && (
                  <>
                    <button
                      onClick={() => reviewSecurityFlag(flag.id, 'reviewed')}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-primary"
                    >
                      Mark Reviewed
                    </button>
                    <button
                      onClick={() => reviewSecurityFlag(flag.id, 'escalated')}
                      className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/10"
                    >
                      Escalate
                    </button>
                  </>
                )}
                {flag.status !== 'new' && (
                  <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-extrabold capitalize text-muted">
                    {flag.status.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {resolvedAnomalies.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-muted">
            Recently Resolved
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {resolvedAnomalies.map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b border-border p-4 last:border-b-0">
                <p className="text-sm text-muted">
                  {a.customerLabel} · {a.type.replace(/_/g, ' ')}
                </p>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-extrabold capitalize text-primary">
                  {a.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
