import type { Product } from '@/store/useCartStore';

export interface Store {
  id: string;
  name: string;
  address: string;
  distanceKm: number;
  isOpen: boolean;
}

// Mock "nearby stores" data. In production this is GET /stores/nearby?lat&lng&radius_km
// against the `stores` table (with a PostGIS GEOGRAPHY column) from the architecture doc.
export const MOCK_STORES: Store[] = [
  { id: 'store_1', name: 'DMart Supercenter', address: 'HSR Layout, Sector 6, Bangalore', distanceKm: 1.2, isOpen: true },
  { id: 'store_2', name: 'SnapUp Express', address: 'Koramangala 5th Block, Bangalore', distanceKm: 2.8, isOpen: true },
  { id: 'store_3', name: 'FreshMart Central', address: 'Indiranagar 100ft Road, Bangalore', distanceKm: 4.1, isOpen: false },
];

export const MOCK_RECOMMENDED_STORES: Store[] = [
  { id: 'store_4', name: 'DMart Ready', address: 'BTM Layout, Bangalore', distanceKm: 3.4, isOpen: true },
  { id: 'store_5', name: 'SnapUp Express', address: 'Jayanagar 4th Block, Bangalore', distanceKm: 5.0, isOpen: true },
];

// Mock barcode -> product lookup, ported directly from the original ScannerScreen.tsx.
// In production this is GET /products?barcode= against the real `products` table.
export const MOCK_PRODUCT_DB: Record<string, Omit<Product, 'barcode'>> = {
  '012000000133': { id: 'p1', name: 'Diet Pepsi 12oz Can', unit_price: 4000, expected_weight_grams: 380 },
  '049000028904': { id: 'p2', name: 'Coca-Cola 20oz Bottle', unit_price: 6000, expected_weight_grams: 620 },
};

export function lookupProductByBarcode(barcode: string): Product {
  const matched = MOCK_PRODUCT_DB[barcode];
  if (matched) {
    return { ...matched, barcode };
  }
  // Fallback for unknown barcodes, ported from the original mock behavior.
  return {
    id: `auto_${barcode.substring(0, 6)}`,
    barcode,
    name: `Retail Item (${barcode.slice(-4)})`,
    unit_price: Math.floor(Math.random() * 49000) + 1000,
    expected_weight_grams: Math.floor(Math.random() * 400) + 50,
  };
}
