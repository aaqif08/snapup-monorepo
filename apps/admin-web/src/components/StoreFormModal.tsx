'use client';

import { useState } from 'react';
import type { AdminStore, StoreDraft } from '@/lib/storesClient';

interface StoreFormModalProps {
  initial?: AdminStore;
  onSave: (draft: StoreDraft) => Promise<void>;
  onClose: () => void;
}

export default function StoreFormModal({ initial, onSave, onClose }: StoreFormModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [latitude, setLatitude] = useState(initial?.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(initial?.longitude?.toString() ?? '');
  const [ssid, setSsid] = useState(initial?.advertised_ssid ?? '');
  const [cidrs, setCidrs] = useState((initial?.authorized_egress_cidrs ?? []).join('\n'));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isOpen, setIsOpen] = useState(initial?.is_open ?? true);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim() || !address.trim() || !ssid.trim()) {
      setError('Name, address and Wi-Fi SSID are required.');
      return;
    }

    const parsedLat = Number(latitude);
    const parsedLng = Number(longitude);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await onSave({
        name: name.trim(),
        address: address.trim(),
        latitude: parsedLat,
        longitude: parsedLng,
        // One CIDR per line. Server-side validation is the authority; this only splits.
        authorizedEgressCidrs: cidrs
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        advertisedSsid: ssid.trim(),
        isActive,
        isOpen,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the store.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/40 sm:items-center">
      <div className="my-8 w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl">
        <h2 className="mb-4 text-lg font-extrabold text-ink">
          {initial ? `Edit ${initial.name}` : 'Add New Store'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Store Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. DMart Supercenter"
            />
          </Field>

          <Field label="Address">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
              placeholder="e.g. HSR Layout, Sector 6, Bangalore"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                inputMode="decimal"
                className={inputClass}
                placeholder="12.9082"
              />
            </Field>
            <Field label="Longitude">
              <input
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                inputMode="decimal"
                className={inputClass}
                placeholder="77.6476"
              />
            </Field>
          </div>

          <p className="-mt-1 text-[11px] leading-relaxed text-muted">
            Coordinates decide where this store appears in customers&apos; “nearest stores”
            list. Copy them from the pin in Google Maps.
          </p>

          <Field label="Customer Wi-Fi SSID">
            <input
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              className={inputClass}
              placeholder="e.g. DMart-Guest"
            />
          </Field>

          <Field label="Authorized network ranges (one per line)">
            <textarea
              value={cidrs}
              onChange={(e) => setCidrs(e.target.value)}
              rows={3}
              className={`${inputClass} font-mono`}
              placeholder="203.0.113.10/32"
            />
          </Field>

          {/* This is the field that decides whether the store works at all, so it gets an
              explanation rather than being left to look like optional metadata. */}
          <div className="rounded-xl border border-border bg-bg p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
              Why this matters
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink">
              SnapUp only unlocks product data for customers whose traffic comes from the
              store&apos;s own network. Enter the static public IP of the store&apos;s
              customer-Wi-Fi gateway as <span className="font-mono">a.b.c.d/32</span>. Leave
              it empty and every customer at this store will be refused.
            </p>
          </div>

          <div className="flex gap-4 pt-1">
            <Toggle label="Active on SnapUp" checked={isActive} onChange={setIsActive} />
            <Toggle label="Currently open" checked={isOpen} onChange={setIsOpen} />
          </div>

          {error && <p className="text-sm font-semibold text-danger">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-extrabold text-ink disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : initial ? 'Save Changes' : 'Add Store'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-muted">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-primary,#0a7)]"
      />
      {label}
    </label>
  );
}
