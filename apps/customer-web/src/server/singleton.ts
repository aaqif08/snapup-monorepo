import 'server-only';

/**
 * Pins a module-level singleton to the process, not to the module instance.
 *
 * Next.js does not guarantee that two route handlers importing the same module share one
 * instance of it — each route is bundled separately, and in development a route is
 * compiled on first request, so `new InMemoryFooRepository()` can run more than once in a
 * single process. Every copy then holds its own state.
 *
 * That is invisible for the product and store repositories, because they are seeded from
 * the same constant and read far more than written: two copies look identical. It is fatal
 * for anything that accumulates state at runtime. It showed up exactly that way here —
 * an order created through `POST /api/orders` was not found by
 * `POST /api/orders/[id]/payment`, and the analytics dashboard read zero from an event log
 * that other routes had been writing to all along.
 *
 * Note what this does and does not fix. It makes state shared within one process. It does
 * nothing across processes, so a serverless deployment with several instances still sees
 * a fraction of the data — that needs the real database these repositories stand in for.
 */
type SingletonRegistry = typeof globalThis & {
  __snapupSingletons?: Map<string, unknown>;
};

export function processSingleton<T>(key: string, create: () => T): T {
  const registry = globalThis as SingletonRegistry;
  registry.__snapupSingletons ??= new Map<string, unknown>();

  const existing = registry.__snapupSingletons.get(key);
  if (existing !== undefined) return existing as T;

  const created = create();
  registry.__snapupSingletons.set(key, created);
  return created;
}
