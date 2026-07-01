import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AdminRole = 'staff' | 'manager' | 'admin';

interface AdminAuthState {
  isAuthenticated: boolean;
  email: string | null;
  role: AdminRole | null;
  /**
   * Mock login — in production this calls POST /auth/login with role-aware
   * RBAC middleware on the backend (per the architecture doc's JWT/RBAC
   * spec). Locally, any non-empty email/password combination succeeds and
   * is assigned the 'manager' role, since that's the most representative
   * role for exercising every screen in this dashboard (staff management,
   * product CRUD, security review all require manager-or-above per RBAC).
   */
  login: (email: string) => void;
  logout: () => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      email: null,
      role: null,
      login: (email) => set({ isAuthenticated: true, email, role: 'manager' }),
      logout: () => set({ isAuthenticated: false, email: null, role: null }),
    }),
    {
      name: 'snapup-admin-auth-storage',
      skipHydration: typeof window === 'undefined',
    }
  )
);
