'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@snapup/ui/ThemeToggle';
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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-primary px-6 py-12">
      {/* A soft wash behind the card so the flat mint has some depth on a large screen. */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-onPrimary/10 blur-3xl"
        aria-hidden
      />

      {/* This screen renders before the nav bar exists, so it carries its own toggle. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle className="border-onPrimary/30 text-onPrimary hover:border-onPrimary hover:text-onPrimary" />
      </div>

      <div className="relative mb-10 flex flex-col items-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-surface shadow-pop">
          <Image src="/logo-mark.png" alt="" width={48} height={48} className="h-12 w-auto" priority />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-onPrimary">SnapUp</h1>
        <p className="mt-1 text-center text-sm font-medium text-onPrimary/85">
          Scan, Pay &amp; Skip the Line
        </p>
      </div>

      <div className="relative w-full max-w-sm animate-scale-in rounded-3xl bg-surface p-6 shadow-pop">
        <button
          onClick={handleGuest}
          className="mb-3 w-full rounded-2xl bg-accent py-4 text-base font-extrabold text-onAccent transition duration-200 hover:opacity-90 active:scale-[0.99]"
        >
          Continue as Guest
        </button>

        <button
          onClick={handleLogin}
          className="w-full rounded-2xl border-2 border-border py-4 text-base font-extrabold text-ink transition duration-200 hover:border-primary hover:text-primary active:scale-[0.99]"
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
