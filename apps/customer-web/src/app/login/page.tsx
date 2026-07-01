'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/';

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [formError, setFormError] = useState<string | null>(null);

  const login = useAuthStore((state) => state.login);

  const handleSendOtp = () => {
    if (phone.length !== 10) {
      setFormError('Enter a valid 10-digit phone number.');
      return;
    }
    setFormError(null);
    // In production: POST /auth/login { phone_number } to trigger a real OTP send.
    setStep('otp');
  };

  const handleVerifyOtp = () => {
    if (otp.length !== 4) {
      setFormError('Enter the 4-digit code.');
      return;
    }
    setFormError(null);
    // In production: POST /auth/login { phone_number, otp } -> { access_token, refresh_token }
    // then POST /carts/merge { guest_session_id } to fold the guest cart into the account.
    login(phone);
    router.push(redirectTo);
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-end bg-primary">
      <div className="w-full rounded-t-[32px] bg-surface p-7 pb-12">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-primary">
          Snap Up In-Store
        </p>

        <h1 className="mb-1.5 mt-3 text-2xl font-extrabold text-ink">
          {step === 'phone' ? 'Scan, Pay & Skip the Line' : 'Verify your number'}
        </h1>
        <p className="mb-7 text-sm text-muted">
          {step === 'phone'
            ? 'Enter your phone number to continue'
            : `Enter the 4-digit OTP sent to +91 ${phone}`}
        </p>

        {step === 'phone' ? (
          <div className="mb-2 flex h-14 items-center rounded-2xl border border-border bg-bg px-4">
            <span className="mr-3 font-bold text-ink">+91</span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter Mobile Number"
              autoFocus
              className="flex-1 bg-transparent text-base font-semibold text-ink outline-none placeholder:text-muted"
            />
          </div>
        ) : (
          <div className="mb-2 flex h-14 items-center rounded-2xl border border-border bg-bg px-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="0 0 0 0"
              autoFocus
              className="w-full bg-transparent text-center text-base font-semibold tracking-[8px] text-ink outline-none placeholder:text-muted"
            />
          </div>
        )}

        {formError && <p className="mb-3 text-sm font-semibold text-red-500">{formError}</p>}

        <button
          onClick={step === 'phone' ? handleSendOtp : handleVerifyOtp}
          className="mt-4 h-14 w-full rounded-2xl bg-accent text-base font-extrabold text-white transition hover:opacity-90"
        >
          {step === 'phone' ? 'Continue' : 'Verify & Proceed'}
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          By continuing, you agree to our Terms of Service &amp; Privacy Policy
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
