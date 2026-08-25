'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * Segmented one-time-code entry.
 *
 * One box per digit rather than a single field, because a code arrives as a *sequence* and
 * a segmented display shows progress against a known length — you can see at a glance that
 * you have typed four of six. It also stops the caret from ever landing mid-string, which
 * is the usual way people end up with `12` `3456` in one field.
 *
 * Three behaviours that are easy to miss and are the difference between this feeling right
 * and feeling hostile:
 *
 *   - **Paste fills every box.** Codes are copied from an SMS far more often than typed,
 *     and per-box inputs classically swallow everything after the first character.
 *   - **Backspace on an empty box steps back.** Otherwise correcting a typo means
 *     reaching for the mouse.
 *   - **`autoComplete="one-time-code"`** on the first box, so iOS and Android offer the
 *     code from the notification. It only works on the first field, which is why it is not
 *     applied to all of them.
 */
export default function OtpInput({
  value,
  length,
  disabled,
  onChange,
  onComplete,
}: {
  value: string;
  length: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  function focusAt(index: number) {
    boxes.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  }

  function emit(next: string) {
    onChange(next);
    if (next.length === length) onComplete?.(next);
  }

  function handleInput(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;

    // Typing into a filled box replaces from that position rather than appending, so
    // correcting one digit does not require clearing the rest.
    const next = (value.slice(0, index) + digits + value.slice(index + digits.length)).slice(
      0,
      length
    );
    emit(next);
    focusAt(index + digits.length);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        emit(value.slice(0, index) + value.slice(index + 1));
        return;
      }
      // Empty box: clear the one before and move there.
      if (index > 0) {
        emit(value.slice(0, index - 1) + value.slice(index));
        focusAt(index - 1);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    emit(digits);
    focusAt(digits.length);
  }

  return (
    <div
      className="mb-2 flex justify-between gap-2"
      role="group"
      aria-label={`${length}-digit verification code`}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          // maxLength 1 keeps a box to one digit while `handleInput` still accepts a
          // longer burst from an autofill, which arrives as a single input event.
          maxLength={1}
          value={value[index] ?? ''}
          disabled={disabled}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1}`}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={`h-14 w-full min-w-0 rounded-2xl border-2 bg-bg text-center text-xl font-extrabold text-ink outline-none transition-colors duration-200 disabled:opacity-50 ${
            value[index] ? 'border-primary' : 'border-border'
          } focus:border-primary`}
        />
      ))}
    </div>
  );
}
