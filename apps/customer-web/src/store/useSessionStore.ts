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
  /** Epoch seconds. */
  expiresAt: number | null;
  status: SessionStatus;

  setSession: (input: {
    token: string;
    storeId: string;
    storeName: string;
    expiresAt: number;
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
      expiresAt: null,
      status: 'idle',

      setSession: ({ token, storeId, storeName, expiresAt }) =>
        set({ token, storeId, storeName, expiresAt, status: 'active' }),

      // The token is dropped, not just flagged. Keeping a dead token around invites some
      // later code path to retry with it; the server would reject it anyway, but the
      // client should not be holding a credential it knows is void.
      invalidate: (status) => set({ token: null, expiresAt: null, status }),

      reset: () =>
        set({ token: null, storeId: null, storeName: null, expiresAt: null, status: 'idle' }),
    }),
    {
      name: 'snapup-session',
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
