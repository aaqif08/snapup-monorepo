import 'server-only';

/**
 * The seam Requirement 4 is really about. Swapping the POC's in-memory store for a real
 * database is a one-line change here, because every caller depends on the
 * `ProductRepository` interface rather than on a concrete implementation.
 */
export { productRepository } from './memoryRepository';
export { toPublicProduct } from './projection';
export type { InternalProduct, PublicProduct, PageMeta, ProductRepository } from './types';
