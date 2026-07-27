export interface Store {
  id: string;
  name: string;
  address: string;
  distanceKm: number;
  isOpen: boolean;
}

// Mock "nearby stores" data. In production this is GET /stores/nearby?lat&lng&radius_km
// against the `stores` table (with a PostGIS GEOGRAPHY column) from the architecture doc.
//
// This is a public store directory — name, address, opening state — equivalent to what a
// maps listing shows, so it is not covered by the CTO's requirement 2 restrictions and is
// fine to keep client-side for the POC. The *product* database is a different matter and
// no longer lives here; see below.
export const MOCK_STORES: Store[] = [
  { id: 'store_1', name: 'DMart Supercenter', address: 'HSR Layout, Sector 6, Bangalore', distanceKm: 1.2, isOpen: true },
  { id: 'store_2', name: 'SnapUp Express', address: 'Koramangala 5th Block, Bangalore', distanceKm: 2.8, isOpen: true },
  { id: 'store_3', name: 'FreshMart Central', address: 'Indiranagar 100ft Road, Bangalore', distanceKm: 4.1, isOpen: false },
];

export const MOCK_RECOMMENDED_STORES: Store[] = [
  { id: 'store_4', name: 'DMart Ready', address: 'BTM Layout, Bangalore', distanceKm: 3.4, isOpen: true },
  { id: 'store_5', name: 'SnapUp Express', address: 'Jayanagar 4th Block, Bangalore', distanceKm: 5.0, isOpen: true },
];

// MOCK_PRODUCT_DB and lookupProductByBarcode used to live here and were imported directly
// by the scanner page — which meant the entire product table was compiled into the browser
// bundle and readable by anyone who opened devtools. CTO requirement 2 rules that out.
//
// The catalogue now lives in `src/server/products/`, behind an `import 'server-only'`
// guard so it cannot be pulled back into a client component even by accident, and is
// reachable only via GET /api/products/* with an active presence-verified session.
// Client code should call `lookupBarcode()` from `src/lib/api.ts` instead.
