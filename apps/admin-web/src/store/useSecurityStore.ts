import { create } from 'zustand';
import { MOCK_ANOMALIES, MOCK_SECURITY_FLAGS, type AnomalyRecord, type SecurityFlag } from '@/lib/mockData';

interface SecurityState {
  anomalies: AnomalyRecord[];
  securityFlags: SecurityFlag[];
  resolveAnomaly: (id: string, status: AnomalyRecord['status']) => void;
  reviewSecurityFlag: (id: string, status: SecurityFlag['status']) => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  anomalies: MOCK_ANOMALIES,
  securityFlags: MOCK_SECURITY_FLAGS,

  resolveAnomaly: (id, status) => {
    set((state) => ({
      anomalies: state.anomalies.map((a) => (a.id === id ? { ...a, status } : a)),
    }));
  },

  reviewSecurityFlag: (id, status) => {
    set((state) => ({
      securityFlags: state.securityFlags.map((f) => (f.id === id ? { ...f, status } : f)),
    }));
  },
}));
