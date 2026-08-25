import { create } from 'zustand';
import { fetchMe, logout as logoutRequest, type AccountUser, type Role } from '@/lib/accountClient';

export type AdminRole = Role;

/**
 * Console session state.
 *
 * ## What this replaced
 *
 * The previous store accepted any email with any six-character password, assigned itself
 * the `manager` role, and persisted `isAuthenticated: true` to localStorage. Nothing
 * server-side ever checked it — so the store registry, including every branch's authorised
 * network ranges, was editable by anyone who could open the login page and type an `@`.
 *
 * Authentication now lives in an `httpOnly` cookie the browser cannot read, and the role
 * comes from the server on every load.
 *
 * ## Nothing is persisted here
 *
 * Deliberately no `persist` middleware, unlike the customer store. A console session is
 * always confirmed against the server before anything renders — the extra round trip is
 * imperceptible on a desktop dashboard, and caching a role in localStorage on a machine
 * that manages eight shops' staff is not a trade worth making. `isReady` gates the UI so
 * there is no flash of the wrong state while that call is in flight.
 *
 * ## No auto-logout
 *
 * No timer, no idle watcher. `logout()` is the only exit, and it is a server call. An
 * owner revoking someone in Staff management is the other way a session ends — the server
 * re-reads `isActive` on every request, so it takes effect on the next one.
 */
interface AdminAuthState {
  user: AccountUser | null;
  isAuthenticated: boolean;
  isReady: boolean;
  /** False when the API has no database, so accounts are lost on restart. */
  accountsDurable: boolean;

  hydrate: () => Promise<void>;
  setUser: (user: AccountUser) => void;
  logout: () => Promise<void>;
}

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isReady: false,
  accountsDurable: true,

  hydrate: async () => {
    try {
      const { user, accounts_durable } = await fetchMe();
      set({
        user,
        // A customer account is a valid session and still must not open the console. The
        // API enforces this as well; this is what stops the UI rendering first and
        // correcting itself a moment later.
        isAuthenticated: user !== null && user.role !== 'customer',
        accountsDurable: accounts_durable,
        isReady: true,
      });
    } catch {
      set({ user: null, isAuthenticated: false, isReady: true });
    }
  },

  setUser: (user) => set({ user, isAuthenticated: user.role !== 'customer', isReady: true }),

  logout: async () => {
    try {
      await logoutRequest();
    } finally {
      // Cleared even if the call failed, so the UI never shows a signed-in state after
      // someone has tapped Log out. If the cookie survived, the next hydrate finds it.
      set({ user: null, isAuthenticated: false });
    }
  },
}));
