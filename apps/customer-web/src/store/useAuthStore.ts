import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fetchMe, logout as logoutRequest, type AccountUser } from '@/lib/authClient';

/**
 * Client-side view of the account session.
 *
 * ## What changed and why it matters
 *
 * This store used to *be* the authentication: `login(phone)` set `isAuthenticated: true`
 * in localStorage and nothing ever checked it. Anyone could flip that flag in devtools and
 * be "logged in", which was fine for a mock and is not fine now that an account carries a
 * role and the console manages staff.
 *
 * The truth now lives in an `httpOnly` cookie the browser cannot read, and `hydrate()`
 * asks the server who that cookie belongs to. What is persisted here is a *cache* of that
 * answer, kept only so the UI does not flash a signed-out state on every navigation.
 * Nothing is trusted on the strength of it: every protected route re-checks server-side.
 *
 * ## No auto-logout
 *
 * There is no timer, no idle watcher and no expiry. `logout()` is the only thing that ends
 * a session, and it is a server call — clearing local state alone would leave the cookie
 * live and the user still signed in on the next reload.
 */
interface AuthState {
  user: AccountUser | null;
  isAuthenticated: boolean;

  /** True once `hydrate()` has heard back, so the UI can wait rather than guess. */
  isReady: boolean;

  /**
   * True once the person has made an explicit choice on the Landing screen — either
   * "Continue as Guest" or a completed login. Distinct from `isAuthenticated`: a guest has
   * `hasEnteredApp = true` and `isAuthenticated = false`. Drives whether `/` shows the
   * landing choice or the home page.
   */
  hasEnteredApp: boolean;

  /** False when the server has no database configured, so accounts vanish on restart. */
  accountsDurable: boolean;

  hydrate: () => Promise<void>;
  setUser: (user: AccountUser) => void;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isReady: false,
      hasEnteredApp: false,
      accountsDurable: true,

      hydrate: async () => {
        try {
          const { user, accounts_durable } = await fetchMe();
          set({
            user,
            isAuthenticated: user !== null,
            accountsDurable: accounts_durable,
            isReady: true,
            // Signing in counts as entering the app, so a returning user never sees the
            // landing choice again.
            hasEnteredApp: user !== null ? true : undefined,
          } as Partial<AuthState>);
        } catch {
          // Offline or the API is down. Treat as signed out for display purposes but do
          // not clear `hasEnteredApp` — dropping someone back to the landing screen
          // because their train went into a tunnel is worse than showing a stale name.
          set({ user: null, isAuthenticated: false, isReady: true });
        }
      },

      setUser: (user) => set({ user, isAuthenticated: true, hasEnteredApp: true, isReady: true }),

      logout: async () => {
        try {
          await logoutRequest();
        } finally {
          // Cleared even if the request failed. If the cookie survived, the next `hydrate`
          // will find it and sign the user back in — which is the honest outcome — but
          // leaving the UI showing a signed-in state after they tapped Log out is not.
          set({ user: null, isAuthenticated: false });
        }
      },

      continueAsGuest: () => set({ hasEnteredApp: true }),
    }),
    {
      name: 'snapup-auth-storage',
      skipHydration: typeof window === 'undefined',
      // `isReady` is deliberately not persisted: a fresh page load has not yet asked the
      // server anything, and restoring `isReady: true` would let the UI render a cached
      // identity as though it had been confirmed.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        hasEnteredApp: state.hasEnteredApp,
      }),
    }
  )
);
