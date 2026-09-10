import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type SessionStatus =
  | 'idle'
  /** Both presence factors passed; database access is unlocked. */
  | 'active'
  /** Presence check failed on a later request — customer has left the store network. */
  | 'presence_lost'
  /** The 30-minute cap elapsed. */
  | 'expired'
  /** Ended deliberately (checkout, or the customer tapped finish). */
  | 'ended';

interface SessionState {
  token: string | null;
  storeId: string | null;
  storeName: string | null;
  /**
   * Epoch **milliseconds**, so it compares directly with `Date.now()`.
   *
   * The unit is in the name because leaving it out cost a live session. The gateway sends
   * `expires_at` in seconds; this field used to store that verbatim and two consumers then
   * disagreed about what it meant — the scan screen subtracted seconds, the timer
   * subtracted `Date.now()`. The timer's arithmetic was off by a factor of a thousand, so
   * every session read 00:00 the instant it started and the expiry callback tore down a
   * session that had a full thirty minutes left.
   */
  expiresAtMs: number | null;
  status: SessionStatus;

  setSession: (input: {
    token: string;
    storeId: string;
    storeName: string;
    expiresAtMs: number;
  }) => void;
  /** Called when the server tells us presence is gone or the session is over. */
  invalidate: (status: Exclude<SessionStatus, 'active' | 'idle'>) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      storeId: null,
      storeName: null,
      expiresAtMs: null,
      status: 'idle',

      setSession: ({ token, storeId, storeName, expiresAtMs }) =>
        set({ token, storeId, storeName, expiresAtMs, status: 'active' }),

      // The token is dropped, not just flagged. Keeping a dead token around invites some
      // later code path to retry with it; the server would reject it anyway, but the
      // client should not be holding a credential it knows is void.
      invalidate: (status) => set({ token: null, expiresAtMs: null, status }),

      reset: () =>
        set({ token: null, storeId: null, storeName: null, expiresAtMs: null, status: 'idle' }),
    }),
    {
      name: 'snapup-session',
      // Bumped when `expiresAt` (seconds) became `expiresAtMs` (milliseconds). Without
      // this, a tab holding the old shape rehydrates `status: 'active'` with no expiry at
      // all — a session the UI believes in and cannot time. Discarding is right: the token
      // is IP-bound and short-lived, so the cost is one rescan.
      version: 2,
      migrate: () => ({}) as never,
      // sessionStorage, not localStorage: the token is a presence credential, and it
      // should not outlive the tab. It is already IP-bound and expires in 30 minutes,
      // so this is defence in depth rather than the primary control.
      storage: createJSONStorage(() =>
        typeof window === 'undefined' ? (undefined as unknown as Storage) : window.sessionStorage
      ),
      skipHydration: typeof window === 'undefined',
    }
  )
);
