'use client';

/**
 * The three-step progress rail from the design: scan → cart → pay.
 *
 * A rail rather than a breadcrumb because the steps are not navigable — you cannot jump
 * to payment from an empty cart — so it reports position rather than offering movement.
 * Completed steps stay filled so the customer can see how far they have come, which on a
 * three-step flow is most of the reassurance the component provides.
 */
export type CheckoutStep = 'scan' | 'cart' | 'pay';

const STEPS: { id: CheckoutStep; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'cart', label: 'Cart' },
  { id: 'pay', label: 'Pay' },
];

export default function CheckoutStepper({ current }: { current: CheckoutStep }) {
  const index = STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="flex items-center justify-center gap-0 px-8 py-5" aria-label="Checkout progress">
      {STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        const reached = done || active;

        return (
          <li key={step.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                aria-current={active ? 'step' : undefined}
                className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200 ${
                  reached ? 'bg-primary text-onPrimary' : 'bg-border text-muted'
                }`}
              >
                <StepIcon step={step.id} />
              </span>
              <span
                className={`text-[11px] font-bold ${reached ? 'text-ink' : 'text-muted'}`}
              >
                {step.label}
              </span>
            </div>

            {position < STEPS.length - 1 && (
              // The connector fills only when the *next* step has been reached, so the
              // rail reads as a line being drawn rather than as a track already laid.
              <span
                aria-hidden
                className={`mx-1 mb-5 h-1 w-12 rounded-full transition-colors duration-200 sm:w-16 ${
                  position < index ? 'bg-primary' : 'bg-border'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ step }: { step: CheckoutStep }) {
  if (step === 'scan') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="14" width="3" height="3" rx="0.5" />
        <rect x="18" y="18" width="3" height="3" rx="0.5" />
      </svg>
    );
  }

  if (step === 'cart') {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.55L21 8H6" />
        <circle cx="9.5" cy="20" r="1.4" />
        <circle cx="17.5" cy="20" r="1.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
    </svg>
  );
}
