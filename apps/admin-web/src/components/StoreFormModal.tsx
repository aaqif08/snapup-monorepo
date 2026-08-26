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
  const [merchantVpa, setMerchantVpa] = useState(initial?.merchant_vpa ?? '');
  const [merchantDisplayName, setMerchantDisplayName] = useState(
    initial?.merchant_display_name ?? ''
  );
  const [apiBaseUrl, setApiBaseUrl] = useState(initial?.api_base_url ?? '');
  const [apiKeyRef, setApiKeyRef] = useState(initial?.api_key_ref ?? '');
  /**
   * Always starts empty, even when editing a branch that has a key.
   *
   * There is nothing to prefill it with — the server returns a mask, never the key —
   * and prefilling the mask would be worse than empty: submitting the form would then
   * save the literal bullet characters as the credential.
   */
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
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

    // Coordinates are optional, and blank means "not surveyed yet" rather than zero.
    //
    // A branch is routinely registered from its published address days before anyone
    // visits it to take a reading. Forcing a number here is what produces a register full
    // of `0, 0` — a real position off the coast of Ghana that looks like data, sorts every
    // customer 2 000 km away, and is indistinguishable from a genuine reading afterwards.
    // Blank is honest and the console flags it until it is filled in.
    const latBlank = latitude.trim() === '';
    const lngBlank = longitude.trim() === '';

    if (latBlank !== lngBlank) {
      setError('Enter both latitude and longitude, or leave both blank until surveyed.');
      return;
    }

    const parsedLat = latBlank ? null : Number(latitude);
    const parsedLng = lngBlank ? null : Number(longitude);

    if (parsedLat !== null && (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
      setError('Latitude must be a number between -90 and 90, or blank.');
      return;
    }
    if (
      parsedLng !== null &&
      (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180)
    ) {
      setError('Longitude must be a number between -180 and 180, or blank.');
      return;
    }

    // Catches the most damaging paste in this form: an API key into the reference field.
    // The server rejects it too, but by then it has crossed the network in a request body
    // that may well be logged.
    const keyRef = apiKeyRef.trim().toUpperCase();
    if (keyRef && !/^[A-Z][A-Z0-9_]{0,63}$/.test(keyRef)) {
      setError(
        'The API key reference is the NAME of an environment variable (e.g. KMB_TRICHY), not the key itself.'
      );
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
        // Empty means "not supplied yet", which is a legitimate state — the store is still
        // shoppable, it just cannot take in-app UPI until the retailer provides a VPA.
        merchantVpa: merchantVpa.trim() || null,
        merchantDisplayName: merchantDisplayName.trim() || null,
        // Blank means "use the platform-wide endpoint", which is correct for a retailer
        // running one central system.
        apiBaseUrl: apiBaseUrl.trim() || null,
        apiKeyRef: keyRef || null,
        // Three states, and the difference matters: omitted keeps the stored key,
        // null clears it, a string replaces it. Sending '' on every save would wipe
        // the credential of any branch somebody merely renamed.
        ...(clearApiKey
          ? { apiKey: null }
          : apiKey.trim()
            ? { apiKey: apiKey.trim() }
            : {}),
        isActive,
        isOpen,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the store.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/50 backdrop-blur-sm sm:items-center">
      <div className="my-8 w-full max-w-md animate-fade-in-up rounded-t-3xl border border-border bg-surface p-6 shadow-pop sm:rounded-3xl">
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
            <Field label="Latitude (optional)">
              <input
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                inputMode="decimal"
                className={inputClass}
                placeholder="10.805500"
              />
            </Field>
            <Field label="Longitude (optional)">
              <input
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                inputMode="decimal"
                className={inputClass}
                placeholder="78.686700"
              />
            </Field>
          </div>

          <p className="-mt-1 text-[11px] leading-relaxed text-muted">
            Coordinates decide where this store appears in customers&apos; “nearest stores”
            list. Stand at the shop entrance, long-press the pin in Google Maps and copy the
            two numbers. <strong>Leave both blank if you have not surveyed it yet</strong> —
            the store still works, it is simply listed last with no distance. Never enter 0.
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

          <Field label="Merchant UPI address (VPA)">
            <input
              value={merchantVpa}
              onChange={(e) => setMerchantVpa(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="shopname@okhdfcbank"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field label="Payee name shown in the customer's UPI app">
            <input
              value={merchantDisplayName}
              onChange={(e) => setMerchantDisplayName(e.target.value)}
              className={inputClass}
              placeholder="Defaults to the store name"
            />
          </Field>

          {/* Money goes straight from the customer to this address. A typo sends it to a
              stranger and SnapUp never sees the transaction, so this warning is not
              boilerplate — it is the only check that exists today. */}
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-warning">
              Verify before go-live
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-warning">
              Customers pay this address <strong>directly</strong> — SnapUp does not hold the
              money and cannot reverse a payment sent to the wrong VPA. The format is checked,
              but not the owner. Send a ₹1 test payment and confirm the retailer received it
              before this store takes real customers.
            </p>
          </div>

          <Field label="Branch API base URL (optional)">
            <input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="https://trichy.example.com/api"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field label="Branch API key reference (optional)">
            <input
              value={apiKeyRef}
              onChange={(e) => setApiKeyRef(e.target.value)}
              className={`${inputClass} font-mono uppercase`}
              placeholder="KMB_TRICHY"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </Field>

          {/* The pilot field. `api_key_ref` above needs someone who can edit the hosting
              environment; this needs someone who can paste. The server seals it and never
              returns it, so the mask below is all the console can ever show. */}
          <Field label="Branch database API key (paste here)">
            {initial?.api_key_masked && !clearApiKey && !apiKey.trim() ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-ink">{initial.api_key_masked}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Set{' '}
                    {initial.api_key_set_at
                      ? new Date(initial.api_key_set_at).toLocaleDateString()
                      : 'previously'}
                    {initial.api_key_fingerprint ? ` · ${initial.api_key_fingerprint}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setApiKey(' ')}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-extrabold text-ink"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setClearApiKey(true)}
                    className="rounded-lg border border-danger/40 px-2.5 py-1.5 text-[11px] font-extrabold text-danger"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  value={apiKey.trim() === '' ? apiKey.replace(' ', '') : apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setClearApiKey(false);
                  }}
                  type="password"
                  className={`${inputClass} font-mono`}
                  placeholder={clearApiKey ? 'Key will be removed on save' : 'Paste the key from the retailer'}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
                {(initial?.api_key_masked || clearApiKey) && (
                  <button
                    type="button"
                    onClick={() => {
                      setApiKey('');
                      setClearApiKey(false);
                    }}
                    className="mt-1.5 text-[11px] font-bold text-muted underline"
                  >
                    Keep the existing key
                  </button>
                )}
              </>
            )}
          </Field>

          {/* The distinction between a reference and a key is the one thing an operator is
              most likely to get wrong here, and getting it wrong writes a live credential
              into a table that gets backed up. Said plainly, next to the field. */}
          <div className="rounded-xl border border-border bg-bg p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
              Branches with their own system
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink">
              Leave both blank if the chain runs one central API — this store will use the
              platform endpoint. Fill them in when this branch has its own server.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink">
              The reference is the <strong>name of an environment variable</strong>, not the
              key. <span className="font-mono">KMB_TRICHY</span> means the deployment must
              set <span className="font-mono">SNAPUP_STORE_API_KEY_KMB_TRICHY</span>. Never
              paste the key itself here — it would be stored in the registry and appear in
              every backup.
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
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-extrabold text-onPrimary hover:opacity-90 disabled:opacity-50"
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
  'w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm font-semibold text-ink outline-none transition-colors duration-200 focus:border-primary';

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
