import 'server-only';

/**
 * The seam Requirement 4 is really about. Swapping the POC's in-memory store for a real
 * database is a one-line change here, because every caller depends on the
 * `ProductRepository` interface rather than on a concrete implementation.
 */
export { productRepository, DuplicateBarcodeError } from './memoryRepository';
export { toPublicProduct } from './projection';
export { toAdminProduct } from './adminProjection';
export type { AdminProduct } from './adminProjection';
export type {
  InternalProduct,
  PublicProduct,
  PageMeta,
  ProductDraft,
  ProductRepository,
} from './types';
