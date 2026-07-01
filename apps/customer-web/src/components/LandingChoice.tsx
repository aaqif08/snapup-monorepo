'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';

export default function LandingChoice() {
  const router = useRouter();
  const continueAsGuest = useAuthStore((state) => state.continueAsGuest);

  const handleGuest = () => {
    // Marks hasEnteredApp = true. The guest_session_id itself already exists
    // (created automatically by useCartStore on first load) — this just
    // records that the person has passed the landing choice.
    continueAsGuest();
    router.push('/');
  };

  const handleLogin = () => {
    router.push('/login?redirect=/');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-primary px-6 py-12">
      <div className="mb-10 flex flex-col items-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-lg">
          <Image src="/logo-mark.png" alt="SnapUp" width={48} height={48} priority />
        </div>
        <h1 className="text-2xl font-extrabold text-white">SnapUp</h1>
        <p className="mt-1 text-center text-sm font-medium text-white/85">
          Scan, Pay &amp; Skip the Line
        </p>
      </div>

      <div className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-xl">
        <button
          onClick={handleGuest}
          className="mb-3 w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-white transition hover:opacity-90"
        >
          Continue as Guest
        </button>

        <button
          onClick={handleLogin}
          className="w-full rounded-2xl border-2 border-border py-4 text-base font-extrabold text-ink transition hover:border-primary hover:text-primary"
        >
          Login with Phone Number
        </button>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          Browsing and shopping as a guest is always free. You can log in
          anytime — even at checkout — to save on your order.
        </p>
      </div>
    </div>
  );
}
