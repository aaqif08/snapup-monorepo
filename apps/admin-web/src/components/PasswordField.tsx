'use client';

import { useId, useState, type KeyboardEvent } from 'react';

export const MIN_PASSWORD = 10;

/**
 * A password input with the three affordances people expect and most forms omit.
 *
 * **Show/hide.** Typing a long password blind into a masked field is the reason people
 * choose short ones. Revealing it is the single highest-value thing a password field can
 * offer, and the risk it is usually withheld for — someone reading over your shoulder —
 * is under the user's own control in a way a typo is not.
 *
 * **Caps Lock warning.** The classic silent failure: the password is right, the shift
 * state is not, and the form just says "incorrect". `getModifierState` is the only way to
 * know, and it is only readable during a key event.
 *
 * **A strength meter that measures length.** Deliberately not a composition checker.
 * "One uppercase, one symbol" rules measurably push people towards `Password1!` and are
 * advised against by NIST SP 800-63B; length is the property that actually costs an
 * attacker anything, so length is what this reports.
 */
export default function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  showStrength = false,
  autoFocus = false,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: 'current-password' | 'new-password';
  showStrength?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    // Wrapped: `getModifierState` is unimplemented on some older mobile keyboards, and a
    // throw here would swallow the keystroke.
    try {
      setCapsLock(event.getModifierState('CapsLock'));
    } catch {
      /* not knowable on this keyboard */
    }
  }

  const strength = measure(value);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-extrabold uppercase tracking-wide text-muted">
          {label}
        </label>
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          // Not in the tab order: it sits between the password field and the submit button,
          // and stopping there on the way to submitting is a nuisance for every user in
          // order to help the few who want it. Reachable by pointer and by screen reader.
          tabIndex={-1}
          aria-pressed={revealed}
          className="text-[11px] font-extrabold uppercase tracking-wide text-primary hover:underline"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>

      <input
        id={id}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={trackCapsLock}
        onKeyUp={trackCapsLock}
        onBlur={() => setCapsLock(false)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-describedby={showStrength ? `${id}-strength` : undefined}
        className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary disabled:opacity-60"
      />

      {capsLock && (
        <p className="mt-1.5 text-[11px] font-bold text-warning">Caps Lock is on.</p>
      )}

      {showStrength && value.length > 0 && (
        <div id={`${id}-strength`} className="mt-2">
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((step) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                  step < strength.filled ? strength.barClass : 'bg-border'
                }`}
              />
            ))}
          </div>
          <p className={`mt-1 text-[11px] font-bold ${strength.textClass}`}>{strength.label}</p>
        </div>
      )}

      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Length-based strength, with the floor called out explicitly.
 *
 * The thresholds are round numbers rather than an entropy estimate: a bar that claims to
 * know a password's entropy is guessing, because it cannot know whether the words in it
 * came from a wordlist.
 */
function measure(value: string) {
  if (value.length === 0) {
    return { filled: 0, label: '', barClass: 'bg-border', textClass: 'text-muted' };
  }
  if (value.length < MIN_PASSWORD) {
    return {
      filled: 1,
      label: `Too short — ${MIN_PASSWORD - value.length} more character${
        MIN_PASSWORD - value.length === 1 ? '' : 's'
      } needed`,
      barClass: 'bg-danger',
      textClass: 'text-danger',
    };
  }
  if (value.length < 14) {
    return { filled: 2, label: 'Acceptable', barClass: 'bg-warning', textClass: 'text-warning' };
  }
  if (value.length < 20) {
    return { filled: 3, label: 'Good', barClass: 'bg-primary', textClass: 'text-primary' };
  }
  return { filled: 4, label: 'Strong', barClass: 'bg-accent', textClass: 'text-accent' };
}
