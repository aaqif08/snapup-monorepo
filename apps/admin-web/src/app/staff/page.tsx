'use client';

import { useState } from 'react';
import { useStaffStore } from '@/store/useStaffStore';
import type { StaffMember } from '@/lib/mockData';

const ROLES: StaffMember['role'][] = ['staff', 'manager', 'admin'];

export default function StaffPage() {
  const { staff, addStaff, suspendStaff, reactivateStaff } = useStaffStore();
  const [isAdding, setIsAdding] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('staff');
  const [employeeCode, setEmployeeCode] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !employeeCode.trim()) return;
    addStaff({
      fullName: fullName.trim(),
      email: email.trim(),
      role,
      employeeCode: employeeCode.trim(),
      status: 'active',
      hiredAt: new Date().toISOString().slice(0, 10),
    });
    setFullName('');
    setEmail('');
    setEmployeeCode('');
    setRole('staff');
    setIsAdding(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-extrabold text-ink">Staff</h1>
          <p className="text-sm text-muted">{staff.filter((s) => s.status === 'active').length} active accounts</p>
        </div>
        <button
          onClick={() => setIsAdding((v) => !v)}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white hover:opacity-90"
        >
          {isAdding ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAdd} className="mb-6 space-y-3 rounded-2xl border border-border bg-surface p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Work email"
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
            />
            <input
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="Employee code (e.g. EMP-004)"
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffMember['role'])}
              className="rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="w-full rounded-xl bg-accent py-3 text-sm font-extrabold text-white">
            Create Staff Account
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {staff.map((member) => (
          <div
            key={member.id}
            className="flex flex-col gap-3 border-b border-border p-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-bold text-ink">{member.fullName}</p>
              <p className="text-xs text-muted">
                {member.email} · {member.employeeCode} ·{' '}
                <span className="font-bold capitalize">{member.role}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  member.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'
                }`}
              >
                {member.status === 'active' ? 'Active' : 'Suspended'}
              </span>
              {member.status === 'active' ? (
                <button
                  onClick={() => suspendStaff(member.id)}
                  className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/10"
                >
                  Suspend
                </button>
              ) : (
                <button
                  onClick={() => reactivateStaff(member.id)}
                  className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10"
                >
                  Reactivate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
