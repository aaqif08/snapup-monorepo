interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  accent?: 'primary' | 'danger' | 'warning';
}

export default function KpiCard({ label, value, sublabel, accent = 'primary' }: KpiCardProps) {
  const accentClass = {
    primary: 'text-primary',
    danger: 'text-danger',
    warning: 'text-warning',
  }[accent];

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-2xl font-extrabold ${accentClass}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-muted">{sublabel}</p>}
    </div>
  );
}
