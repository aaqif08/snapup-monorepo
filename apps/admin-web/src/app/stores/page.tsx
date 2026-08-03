'use client';

import { useCallback, useEffect, useState } from 'react';
import StoreFormModal from '@/components/StoreFormModal';
import {
  createStore,
  listStores,
  updateStore,
  type AdminStore,
  type StoreDraft,
} from '@/lib/storesClient';

type ModalState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; store: AdminStore };

export default function StoresPage() {
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStores(await listStores());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load stores.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (draft: StoreDraft) => {
    const result =
      modal.mode === 'edit' ? await updateStore(modal.store.id, draft) : await createStore(draft);

    setWarnings(result.warnings);
    setModal({ mode: 'closed' });
    await load();
  };

  const toggleActive = async (store: AdminStore) => {
    try {
      const result = await updateStore(store.id, { isActive: !store.is_active });
      setWarnings(result.warnings);
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the store.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Stores</h1>
          <p className="mt-1 text-sm text-muted">
            Locations where SnapUp is available. Customers see active stores, sorted by
            distance from wherever they are.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-onPrimary hover:opacity-90"
        >
          Add Store
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-warning">
            Saved with warnings
          </p>
          <ul className="list-inside list-disc space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="text-sm leading-relaxed text-warning">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-danger/40 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-danger">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-xs font-extrabold text-danger underline">
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      ) : stores.length === 0 && !error ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          No stores registered yet. Add the first one to make SnapUp available there.
        </p>
      ) : (
        <div className="space-y-3">
          {stores.map((store) => (
            <StoreRow
              key={store.id}
              store={store}
              onEdit={() => setModal({ mode: 'edit', store })}
              onToggleActive={() => void toggleActive(store)}
            />
          ))}
        </div>
      )}

      {modal.mode !== 'closed' && (
        <StoreFormModal
          initial={modal.mode === 'edit' ? modal.store : undefined}
          onSave={handleSave}
          onClose={() => setModal({ mode: 'closed' })}
        />
      )}
    </div>
  );
}

function StoreRow({
  store,
  onEdit,
  onToggleActive,
}: {
  store: AdminStore;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const hasNoNetwork = store.authorized_egress_cidrs.length === 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="font-extrabold text-ink">{store.name}</p>
            <span className="font-mono text-[10px] text-muted">{store.id}</span>
            {!store.is_active && (
              <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-extrabold text-muted">
                INACTIVE
              </span>
            )}
            <span
              className={`text-[10px] font-extrabold ${store.is_open ? 'text-primary' : 'text-danger'}`}
            >
              {store.is_open ? 'OPEN' : 'CLOSED'}
            </span>
          </div>

          <p className="text-xs text-muted">{store.address}</p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span>
              📍 {store.latitude.toFixed(4)}, {store.longitude.toFixed(4)}
            </span>
            <span>📶 {store.advertised_ssid}</span>
            <span className="font-mono">
              🔒 {hasNoNetwork ? '— none —' : store.authorized_egress_cidrs.join(', ')}
            </span>
          </div>

          {/* Surfaced on the row, not just after a save: a store in this state is live and
              refusing every customer, and that should be visible at a glance. */}
          {hasNoNetwork && store.is_active && (
            <p className="mt-2 rounded-lg bg-danger/5 px-2 py-1.5 text-[11px] font-semibold text-danger">
              No authorized network — customers here will be refused until a gateway IP is
              added.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="rounded-xl border border-border px-3 py-2 text-xs font-extrabold text-ink transition-colors duration-200 hover:border-primary"
          >
            Edit
          </button>
          <button
            onClick={onToggleActive}
            className={`rounded-xl px-3 py-2 text-xs font-extrabold transition-colors duration-200 ${
              store.is_active
                ? 'border border-danger/40 text-danger hover:bg-danger/10'
                : 'bg-primary text-onPrimary hover:bg-primaryDark'
            }`}
          >
            {store.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}
