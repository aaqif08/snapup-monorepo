'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import KpiCard from '@/components/KpiCard';
import { useProductStore } from '@/store/useProductStore';
import { useSecurityStore } from '@/store/useSecurityStore';
import { MOCK_CATEGORY_BREAKDOWN, MOCK_KPI, MOCK_SALES_TREND } from '@/lib/mockData';

export default function DashboardPage() {
  const products = useProductStore((state) => state.products);
  const anomalies = useSecurityStore((state) => state.anomalies);

  const lowStockCount = products.filter(
    (p) => p.isActive && p.quantityOnHand <= p.reorderThreshold
  ).length;
  const openAnomalies = anomalies.filter(
    (a) => a.status === 'open' || a.status === 'under_review'
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-extrabold text-ink">Dashboard</h1>
      <p className="mb-6 text-sm text-muted">Today&apos;s snapshot across your store.</p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Today's Revenue" value={`₹${MOCK_KPI.todayRevenue.toLocaleString('en-IN')}`} />
        <KpiCard label="Today's Orders" value={String(MOCK_KPI.todayOrders)} />
        <KpiCard label="Avg. Basket Size" value={`₹${MOCK_KPI.avgBasketSize.toFixed(2)}`} />
        <KpiCard
          label="Open Anomalies"
          value={String(openAnomalies)}
          accent={openAnomalies > 0 ? 'danger' : 'primary'}
          sublabel={lowStockCount > 0 ? `${lowStockCount} products low on stock` : undefined}
        />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-extrabold text-ink">Revenue — Last 7 Days</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={MOCK_SALES_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAE9" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#828A89' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#828A89' }} axisLine={false} tickLine={false} width={50} />
                <Tooltip
                  formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Revenue']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5EAE9', fontSize: 13 }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#00C896" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-extrabold text-ink">Revenue by Category</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MOCK_CATEGORY_BREAKDOWN} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5EAE9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#828A89' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={{ fontSize: 12, fill: '#1C1C1C' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Revenue']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #E5EAE9', fontSize: 13 }}
                />
                <Bar dataKey="revenue" fill="#00C896" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {lowStockCount > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-extrabold text-ink">
            ⚠️ {lowStockCount} product{lowStockCount > 1 ? 's' : ''} running low on stock —{' '}
            <a href="/products" className="underline">
              review inventory
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
