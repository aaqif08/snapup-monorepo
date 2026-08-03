import 'server-only';

export { orderRepository } from './memoryRepository';
export {
  priceOrder,
  PLATFORM_FEE_PAISE,
  LOGIN_DISCOUNT_RATE,
  MAX_LINE_QUANTITY,
  MAX_DISTINCT_LINES,
} from './pricing';
export type { PricedOrder, PricingResult, PricingContext, PricingFailure } from './pricing';
export { toCustomerOrder, issueExitToken, verifyExitToken } from './projection';
export type { CustomerOrder, ExitTokenPayload } from './projection';
export type {
  OrderRecord,
  OrderLine,
  OrderDraftLine,
  OrderStatus,
  OrderRepository,
  PaymentConfirmation,
} from './types';
