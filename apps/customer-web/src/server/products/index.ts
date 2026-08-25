import 'server-only';

/**
 * The seam Requirement 4 is really about. Every caller depends on the `ProductRepository`
 * interface rather than on a concrete implementation, so which one is in use is decided in
 * `repository.ts` by a single environment variable and is invisible from here outwards.
 */
export { productRepository } from './repository';
export { DuplicateBarcodeError } from './errors';
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
