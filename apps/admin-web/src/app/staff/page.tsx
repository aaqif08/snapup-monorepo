'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffFormModal from '@/components/StaffFormModal';
import {
  AccountError,
  listStaff,
  removeStaff,
  updateStaff,
  type AccountUser,
  type Role,
} from '@/lib/accountClient';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';

type Editable = Exclude<Role, 'customer'>;

const ROLE_BLURB: Record<Editable, string> = {
  owner: 'Everything, including staff and store settings.',
  manager: 'Products, stores and analytics. Cannot manage staff.',
  staff: 'Exit verification and read-only catalogue.',
};

export default function StaffPage() {
  const actor = useAdminAuthStore((state) => state.user);

  const [staff, setStaff] = useState<AccountUser[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AccountUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listStaff();
      setStaff(result.staff);
      // Taken from the server rather than derived from the local role. The server is the
      // one enforcing it, so anything the client decides independently can only disagree.
      setCanManage(result.can_manage);
      setError(null);
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'Could not load staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, run: () => Promise<{ notice?: string }>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const result = await run();
      if (result.notice) setNotice(result.notice);
      await load();
    } catch (exc) {
      setError(exc instanceof AccountError ? exc.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  }

  const active = staff.filter((member) => member.isActive);
  const pending = staff.filter((member) => !member.isActive);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Staff</h1>
          <p className="mt-1 text-sm text-muted">
            Who can sign in to this console, and what they can do.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-extrabold text-onAccent transition duration-200 hover:opacity-90"
          >
            Add staff
          </button>
        )}
      </header>

      {!canManage && (
        <p className="mb-5 rounded-2xl border border-border bg-surface px-4 py-3 text-[12px] leading-relaxed text-muted">
          You can see the team but not change it. Only an <strong>owner</strong> can add,
          edit or remove staff.
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {notice && (
        <p className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">
          {notice}
        </p>
      )}

      {/* Pending first. These are people waiting on an action from whoever is reading the
          screen, so burying them under the active list would be exactly backwards. */}
      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-warning">
            Waiting for approval · {pending.length}
          </h2>
          <div className="space-y-2">
            {pending.map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={member.id === actor?.id}
                canManage={canManage}
                busy={busyId === member.id}
                onEdit={() => setEditing(member)}
                onActivate={() =>
                  act(member.id, async () => {
                    await updateStaff(member.id, { isActive: true });
                    return { notice: `${member.email} can now sign in.` };
                  })
                }
                onRemove={() => act(member.id, () => removeStaff(member.id))}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">
          Active · {active.length}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-[86px] animate-pulse rounded-2xl border border-border bg-surface" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface px-5 py-12 text-center">
            <p className="text-sm font-bold text-ink">No active staff yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
              {canManage
                ? 'Add a colleague to give them console access. They will need the password you set — it is shown once and cannot be recovered.'
                : 'Ask an owner to add your colleagues.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={member.id === actor?.id}
                canManage={canManage}
                busy={busyId === member.id}
                onEdit={() => setEditing(member)}
                onRemove={() => act(member.id, () => removeStaff(member.id))}
              />
            ))}
          </div>
        )}
      </section>

      <p className="mt-6 text-[11px] leading-relaxed text-muted">
        Removing someone deactivates their account rather than deleting it, so past activity
        stays attributable to a real person. Access is revoked on their next request — there
        is no session to wait out.
      </p>

      {(creating || editing) && (
        <StaffFormModal
          initial={editing ?? undefined}
          isSelf={editing?.id === actor?.id}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setEditing(null);
            setNotice(message ?? null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function StaffRow({
  member,
  isSelf,
  canManage,
  busy,
  onEdit,
  onActivate,
  onRemove,
}: {
  member: AccountUser;
  isSelf: boolean;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onActivate?: () => void;
  onRemove: () => void;
}) {
  const role = member.role as Editable;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
            member.isActive ? 'bg-primary text-onPrimary' : 'bg-muted/20 text-muted'
          }`}
        >
          {(member.name?.trim()?.[0] ?? member.email?.[0] ?? '?').toUpperCase()}
        </span>

        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-extrabold text-ink">
            {member.name?.trim() || member.email}
            {isSelf && (
              <span className="rounded-full bg-tint px-2 py-0.5 text-[10px] font-extrabold uppercase text-primary">
                you
              </span>
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted">{member.email}</p>
          <p className="mt-1 text-[11px] text-muted">
            <RoleChip role={role} /> <span className="ml-1">{ROLE_BLURB[role]}</span>
          </p>
        </div>
      </div>

      {canManage && (
        <div className="flex shrink-0 gap-2">
          {onActivate && (
            <button
              onClick={onActivate}
              disabled={busy}
              className="rounded-xl bg-primary px-3 py-2 text-xs font-extrabold text-onPrimary transition hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
          )}
          <button
            onClick={onEdit}
            disabled={busy}
            className="rounded-xl border border-border px-3 py-2 text-xs font-extrabold text-ink transition hover:border-primary disabled:opacity-50"
          >
            Edit
          </button>
          {member.isActive && (
            <button
              onClick={onRemove}
              // Self-removal is refused by the server; disabling it here means the owner
              // never has to discover that by being told no.
              disabled={busy || isSelf}
              title={isSelf ? 'You cannot remove your own account' : undefined}
              className="rounded-xl border border-danger/40 px-3 py-2 text-xs font-extrabold text-danger transition hover:bg-danger/10 disabled:opacity-30"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RoleChip({ role }: { role: Editable }) {
  const tone =
    role === 'owner'
      ? 'bg-accent/15 text-accent'
      : role === 'manager'
        ? 'bg-primary/15 text-primary'
        : 'bg-muted/15 text-muted';

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tone}`}>
      {role}
    </span>
  );
}
