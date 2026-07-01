import { create } from 'zustand';
import { MOCK_STAFF, type StaffMember } from '@/lib/mockData';

interface StaffState {
  staff: StaffMember[];
  addStaff: (member: Omit<StaffMember, 'id'>) => void;
  suspendStaff: (id: string) => void;
  reactivateStaff: (id: string) => void;
}

export const useStaffStore = create<StaffState>((set) => ({
  staff: MOCK_STAFF,

  addStaff: (member) => {
    set((state) => ({
      staff: [...state.staff, { ...member, id: `s_${Date.now()}` }],
    }));
  },

  suspendStaff: (id) => {
    set((state) => ({
      staff: state.staff.map((s) => (s.id === id ? { ...s, status: 'suspended' } : s)),
    }));
  },

  reactivateStaff: (id) => {
    set((state) => ({
      staff: state.staff.map((s) => (s.id === id ? { ...s, status: 'active' } : s)),
    }));
  },
}));
