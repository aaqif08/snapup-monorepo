// This file used to hold the app's mock data. Both datasets have since moved server-side,
// for different reasons.
//
// MOCK_PRODUCT_DB and lookupProductByBarcode were imported directly by the scanner page —
// which meant the entire product table was compiled into the browser bundle and readable
// by anyone who opened devtools. CTO requirement 2 rules that out. The catalogue now lives
// in `src/server/products/`, behind an `import 'server-only'` guard so it cannot be pulled
// back into a client component even by accident, and is reachable only via
// GET /api/products/* with an active presence-verified session. Client code should call
// `lookupBarcode()` from `src/lib/api.ts`.
//
// MOCK_STORES and MOCK_RECOMMENDED_STORES moved for a different reason: not secrecy, but
// correctness and ownership. Their `distanceKm` values were hardcoded constants, so every
// customer was told a store was 1.2 km away regardless of where they actually were. The
// registry now lives in `src/server/stores/`, distances are computed server-side from the
// device's real coordinates, and stores are administered at runtime rather than being
// edited into a source file. Client code should call `fetchNearbyStores()` from
// `src/lib/api.ts`, and use the `NearbyStore` type exported alongside it.
//
// Nothing imports this file any more. It is kept only as a signpost to where the data went.

export {};
