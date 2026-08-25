'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OtpInput from '@/components/OtpInput';
import { useAuthStore } from '@/store/useAuthStore';
import { AuthError, requestOtp, verifyOtp, type OtpRequestResult } from '@/lib/authClient';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/';
  const setUser = useAuthStore((state) => state.setUser);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [sent, setSent] = useState<OtpRequestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Resend cooldown. Without one, an impatient customer taps "resend" three times, burns
  // the per-number rate limit, and is then locked out for minutes — having done nothing
  // wrong. The server limit still exists; this stops people walking into it.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function send(isResend = false) {
    if (phone.length !== 10) {
      setFormError('Enter your 10-digit mobile number.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const result = await requestOtp(phone);
      setSent(result);
      setStep('otp');
      setResendIn(RESEND_SECONDS);
      if (isResend) setOtp('');
    } catch (error) {
      setFormError(error instanceof AuthError ? error.message : 'Could not send a code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setBusy(true);
    setFormError(null);
    try {
      const { user } = await verifyOtp(phone, code, name.trim() || undefined);
      setUser(user);
      router.push(redirectTo);
    } catch (error) {
      setFormError(error instanceof AuthError ? error.message : 'Could not verify that code.');
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-end bg-primary">
      <div className="w-full animate-fade-in-up rounded-t-[32px] bg-surface p-7 pb-12">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-primary">
          Snap Up In-Store
        </p>

        <h1 className="mb-1.5 mt-3 text-2xl font-extrabold text-ink">
          {step === 'phone' ? 'Scan, Pay & Skip the Line' : 'Verify your number'}
        </h1>
        <p className="mb-7 text-sm text-muted">
          {step === 'phone' ? (
            'Enter your mobile number to continue'
          ) : (
            <>
              We sent a {OTP_LENGTH}-digit code to{' '}
              <span className="font-bold text-ink">{sent?.phone_masked}</span>
            </>
          )}
        </p>

        {step === 'phone' ? (
          <>
            <div className="mb-3 flex h-14 items-center rounded-2xl border border-border bg-bg px-4 transition-colors duration-200 focus-within:border-primary">
              <span className="mr-3 font-bold text-ink">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
                placeholder="Enter Mobile Number"
                autoFocus
                autoComplete="tel"
                className="flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-muted"
              />
            </div>

            {/* Optional, and only used if this number has never signed in before. Asking
                for it up front beats a second screen after verification. */}
            <div className="mb-2 flex h-14 items-center rounded-2xl border border-border bg-bg px-4 transition-colors duration-200 focus-within:border-primary">
              <input
                type="text"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
                placeholder="Your name (optional)"
                autoComplete="name"
                className="flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-muted"
              />
            </div>
          </>
        ) : (
          <>
            <OtpInput
              value={otp}
              length={OTP_LENGTH}
              disabled={busy}
              onChange={setOtp}
              onComplete={(code) => void verify(code)}
            />

            {/* Shown only when the server is writing codes to its own log instead of
                sending an SMS. Loud and ugly on purpose — this must never be mistaken for
                normal behaviour, and the server refuses log delivery in production. */}
            {sent?.dev_code && (
              <div className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-warning">
                  Dev mode — no SMS configured
                </p>
                <p className="mt-0.5 text-sm font-bold text-warning">
                  Your code is <span className="font-mono tracking-widest">{sent.dev_code}</span>
                </p>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setFormError(null);
                }}
                className="text-xs font-bold text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Change number
              </button>

              <button
                type="button"
                disabled={resendIn > 0 || busy}
                onClick={() => void send(true)}
                className="text-xs font-bold text-primary disabled:text-muted"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}

        {formError && (
          <p role="alert" className="mb-3 text-sm font-semibold text-danger">
            {formError}
          </p>
        )}

        <button
          onClick={() => (step === 'phone' ? void send() : void verify(otp))}
          disabled={busy || (step === 'phone' ? phone.length !== 10 : otp.length !== OTP_LENGTH)}
          className="mt-4 h-14 w-full rounded-2xl bg-accent text-base font-extrabold text-onAccent transition duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? 'Please wait…' : step === 'phone' ? 'Send code' : 'Verify & Proceed'}
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          By continuing, you agree to our Terms of Service &amp; Privacy Policy.
          <br />
          You&apos;ll stay signed in until you log out.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
