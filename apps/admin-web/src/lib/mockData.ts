// Mock data for the admin dashboard's local build. In production these are
// replaced by the real endpoints from the architecture doc:
//   GET/POST/PATCH/DELETE /products, /staff/users, /anomalies,
//   /security/flags, /analytics/sales, /analytics/traffic, /inventory/*

export interface AdminProduct {
  id: string;
  barcode: string;
  name: string;
  category: string;
  unitPrice: number; // rupees
  expectedWeightGrams: number;
  quantityOnHand: number;
  reorderThreshold: number;
  isActive: boolean;
}

export interface StaffMember {
  id: string;
  fullName: string;
  email: string;
  role: 'staff' | 'manager' | 'admin';
  employeeCode: string;
  status: 'active' | 'suspended';
  hiredAt: string;
}

export interface AnomalyRecord {
  id: string;
  sessionId: string;
  customerLabel: string;
  type: 'weight_mismatch' | 'unscanned_item_suspected' | 'duplicate_scan';
  expectedWeightGrams: number;
  measuredWeightGrams: number;
  deltaGrams: number;
  status: 'open' | 'under_review' | 'resolved_legitimate' | 'resolved_billed';
  detectedAt: string;
}

export interface SecurityFlag {
  id: string;
  cameraZone: string;
  customerLabel: string;
  behaviorLabel: string;
  confidenceScore: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewed' | 'escalated' | 'false_positive';
  detectedAt: string;
}

export const MOCK_PRODUCTS: AdminProduct[] = [
  { id: 'p1', barcode: '012000000133', name: 'Diet Pepsi 12oz Can', category: 'Beverages', unitPrice: 40, expectedWeightGrams: 380, quantityOnHand: 142, reorderThreshold: 30, isActive: true },
  { id: 'p2', barcode: '049000028904', name: 'Coca-Cola 20oz Bottle', category: 'Beverages', unitPrice: 60, expectedWeightGrams: 620, quantityOnHand: 18, reorderThreshold: 30, isActive: true },
  { id: 'p3', barcode: '890123456001', name: 'Basmati Rice 1kg', category: 'Staples', unitPrice: 120, expectedWeightGrams: 1000, quantityOnHand: 86, reorderThreshold: 20, isActive: true },
  { id: 'p4', barcode: '890123456002', name: 'Toor Dal 1kg', category: 'Staples', unitPrice: 145, expectedWeightGrams: 1000, quantityOnHand: 9, reorderThreshold: 15, isActive: true },
  { id: 'p5', barcode: '890123456003', name: 'Amul Butter 500g', category: 'Dairy', unitPrice: 270, expectedWeightGrams: 500, quantityOnHand: 54, reorderThreshold: 20, isActive: true },
  { id: 'p6', barcode: '890123456004', name: 'Maggi Noodles (Pack of 12)', category: 'Snacks', unitPrice: 168, expectedWeightGrams: 840, quantityOnHand: 0, reorderThreshold: 25, isActive: false },
];

export const MOCK_STAFF: StaffMember[] = [
  { id: 's1', fullName: 'Ravi Kumar', email: 'ravi.kumar@snapup.in', role: 'staff', employeeCode: 'EMP-001', status: 'active', hiredAt: '2025-03-14' },
  { id: 's2', fullName: 'Priya Shah', email: 'priya.shah@snapup.in', role: 'manager', employeeCode: 'EMP-002', status: 'active', hiredAt: '2024-11-02' },
  { id: 's3', fullName: 'Arjun Nair', email: 'arjun.nair@snapup.in', role: 'staff', employeeCode: 'EMP-003', status: 'suspended', hiredAt: '2025-06-21' },
];

export const MOCK_ANOMALIES: AnomalyRecord[] = [
  { id: 'a1', sessionId: 'sess_8821', customerLabel: 'Guest #4471', type: 'weight_mismatch', expectedWeightGrams: 2000, measuredWeightGrams: 2340, deltaGrams: 340, status: 'open', detectedAt: '2026-06-24T08:12:00Z' },
  { id: 'a2', sessionId: 'sess_8809', customerLabel: 'Aaqif R.', type: 'duplicate_scan', expectedWeightGrams: 620, measuredWeightGrams: 620, deltaGrams: 0, status: 'resolved_legitimate', detectedAt: '2026-06-23T17:40:00Z' },
  { id: 'a3', sessionId: 'sess_8795', customerLabel: 'Guest #4408', type: 'unscanned_item_suspected', expectedWeightGrams: 1000, measuredWeightGrams: 1480, deltaGrams: 480, status: 'under_review', detectedAt: '2026-06-23T11:05:00Z' },
];

export const MOCK_SECURITY_FLAGS: SecurityFlag[] = [
  { id: 'f1', cameraZone: 'Checkout Zone A', customerLabel: 'Guest #4471', behaviorLabel: 'concealment_gesture', confidenceScore: 0.87, severity: 'high', status: 'new', detectedAt: '2026-06-24T08:11:30Z' },
  { id: 'f2', cameraZone: 'Aisle 3', customerLabel: 'Guest #4408', behaviorLabel: 'loitering', confidenceScore: 0.52, severity: 'low', status: 'reviewed', detectedAt: '2026-06-23T11:02:00Z' },
  { id: 'f3', cameraZone: 'Exit Gate', customerLabel: 'Unknown', behaviorLabel: 'unscanned_exit_attempt', confidenceScore: 0.93, severity: 'critical', status: 'escalated', detectedAt: '2026-06-22T19:50:00Z' },
];

export interface SalesDataPoint {
  date: string;
  revenue: number;
  orders: number;
}

export const MOCK_SALES_TREND: SalesDataPoint[] = [
  { date: 'Jun 18', revenue: 18400, orders: 142 },
  { date: 'Jun 19', revenue: 21200, orders: 158 },
  { date: 'Jun 20', revenue: 19800, orders: 151 },
  { date: 'Jun 21', revenue: 24600, orders: 179 },
  { date: 'Jun 22', revenue: 27100, orders: 196 },
  { date: 'Jun 23', revenue: 23300, orders: 168 },
  { date: 'Jun 24', revenue: 15900, orders: 97 },
];

export interface CategoryBreakdown {
  category: string;
  revenue: number;
}

export const MOCK_CATEGORY_BREAKDOWN: CategoryBreakdown[] = [
  { category: 'Staples', revenue: 64200 },
  { category: 'Beverages', revenue: 38900 },
  { category: 'Dairy', revenue: 29700 },
  { category: 'Snacks', revenue: 17400 },
];

export const MOCK_KPI = {
  todayRevenue: 15900,
  todayOrders: 97,
  avgBasketSize: 163.9,
  openAnomalies: MOCK_ANOMALIES.filter((a) => a.status === 'open' || a.status === 'under_review').length,
};
