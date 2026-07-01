'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

export default function AdminLoginPage() {
  const router = useRouter();
  const login = useAdminAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a valid work email.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError(null);
    // In production: POST /auth/login { email, password } -> JWT with role
    // claim, validated server-side against staff_profiles + RBAC middleware.
    login(email);
    router.push('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-6 py-12">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg">
            <Image src="/logo-mark.png" alt="SnapUp" width={36} height={36} />
          </div>
          <h1 className="text-xl font-extrabold text-ink">SnapUp Business</h1>
          <p className="mt-1 text-center text-sm text-muted">
            Sign in to manage your store&apos;s products, staff, and analytics.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">
            Work Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@snapup.in"
            className="mb-4 w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-ink outline-none transition focus:border-primary"
          />

          <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mb-4 w-full rounded-xl border border-border bg-bg px-4 py-3 text-sm font-semibold text-ink outline-none transition focus:border-primary"
          />

          {error && <p className="mb-4 text-sm font-semibold text-danger">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-xl bg-accent py-3.5 text-sm font-extrabold text-white transition hover:opacity-90"
          >
            Sign In
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
          Owner/Manager/Staff access only. This is a separate login from the
          SnapUp customer app.
        </p>
      </div>
    </div>
  );
}
