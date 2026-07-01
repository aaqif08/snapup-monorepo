import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  /**
   * True once the person has made an explicit choice on the Landing screen
   * (either "Continue as Guest" or completed login). Distinct from
   * isAuthenticated — a guest who chose "Continue as Guest" has
   * hasEnteredApp=true but isAuthenticated=false. Drives whether `/`
   * shows the Landing choice screen or the Home page.
   */
  hasEnteredApp: boolean;
  // In a real backend this would be a JWT access token, not a boolean —
  // kept simple here since there's no live backend wired up yet in this local build.
  login: (phoneNumber: string) => void;
  logout: () => void;
  continueAsGuest: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      phoneNumber: null,
      hasEnteredApp: false,
      login: (phoneNumber) => set({ isAuthenticated: true, phoneNumber, hasEnteredApp: true }),
      logout: () => set({ isAuthenticated: false, phoneNumber: null }),
      continueAsGuest: () => set({ hasEnteredApp: true }),
    }),
    {
      name: 'snapup-auth-storage',
      skipHydration: typeof window === 'undefined',
    }
  )
);

