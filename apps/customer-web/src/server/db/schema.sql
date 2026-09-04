-- SnapUp durable schema.
--
-- Applied by `npm run db:migrate`. Every statement is idempotent, so re-running it against
-- an existing database is a no-op rather than an error.
--
-- Two conventions carried over from the in-memory repositories, both load-bearing:
--
--   * Money is `integer` paise, never `numeric` or `float`. The application does integer
--     arithmetic throughout and a rounding difference between the two layers would show up
--     as a receipt that disagrees with the dashboard by a paisa.
--   * Nothing is ever deleted. Products and stores carry `is_active`, because orders
--     reference them by id and a deleted row would orphan a paid order.

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stores (
  id                      text PRIMARY KEY,
  name                    text NOT NULL,
  address                 text NOT NULL,

  -- Decimal degrees, WGS84. `double precision` rather than `numeric`: the haversine
  -- calculation is floating point anyway, and metre-level accuracy is far beyond what a
  -- browser's geolocation reports.
  --
  -- Nullable, because a branch is registered from its published address days before anyone
  -- visits it to take a reading. NULL means "not surveyed". It is deliberately not
  -- defaulted to 0: that is a real coordinate off the coast of Ghana, and an unsurveyed
  -- branch sitting there sorts ~2 000 km from every customer while looking well-formed.
  latitude                double precision,
  longitude               double precision,

  -- The store's authorized customer-Wi-Fi egress ranges. An empty array can never grant a
  -- session, which is the fail-closed behaviour a store registered without its network
  -- details must have.
  authorized_egress_cidrs text[] NOT NULL DEFAULT '{}',

  advertised_ssid         text NOT NULL,
  merchant_vpa            text,
  merchant_display_name   text,

  -- Per-branch retail API. A chain does not necessarily run one system: branches get
  -- acquired at different times, run different POS versions, or sit behind their own
  -- site-local server with no central aggregation. NULL falls back to the platform-wide
  -- SNAPUP_STORE_API_BASE / SNAPUP_STORE_API_KEY.
  api_base_url            text,

  -- The NAME of an environment variable, never a key. This table is backed up, dumped, and
  -- read by the admin console; a credential stored here is a credential that leaks.
  api_key_ref             text,

  is_active               boolean NOT NULL DEFAULT true,
  is_open                 boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),

  -- A half-entered coordinate is always a mistake — one degree alone cannot be used for
  -- anything, and a record stuck that way looks surveyed to a glance at the console.
  CONSTRAINT stores_coordinates_paired CHECK ((latitude IS NULL) = (longitude IS NULL)),

  -- Enforces env-var shape, which also rejects a pasted secret: real keys almost always
  -- contain characters outside this set, so this catches the mistake at the database
  -- rather than after it has been committed to a backup.
  CONSTRAINT stores_api_key_ref_shape CHECK (
    api_key_ref IS NULL OR api_key_ref ~ '^[A-Z][A-Z0-9_]{0,63}$'
  )
);

-- Ids stay in the `store_N` shape the admin console and the validation harness expect,
-- rather than becoming UUIDs. A sequence gives that shape without the read-max-then-insert
-- race a naive `MAX(id) + 1` would carry.
CREATE SEQUENCE IF NOT EXISTS store_id_seq AS bigint START 1;

-- ---------------------------------------------------------------------------
-- Stores: in-place migration for databases created before per-branch APIs
-- ---------------------------------------------------------------------------
--
-- `CREATE TABLE IF NOT EXISTS` above is a no-op on an existing database, so the columns
-- and the relaxed nullability have to be applied separately. All of this is idempotent.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_base_url text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_key_ref  text;

ALTER TABLE stores ALTER COLUMN latitude  DROP NOT NULL;
ALTER TABLE stores ALTER COLUMN longitude DROP NOT NULL;

-- Existing rows sitting at exactly 0,0 are almost certainly "unknown" written by a form
-- that had no way to say so, not a genuine reading in the Gulf of Guinea. Promote them to
-- NULL so the readiness report can see them.
UPDATE stores SET latitude = NULL, longitude = NULL
 WHERE latitude = 0 AND longitude = 0;

DO $$
BEGIN
  ALTER TABLE stores ADD CONSTRAINT stores_coordinates_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE stores ADD CONSTRAINT stores_api_key_ref_shape
    CHECK (api_key_ref IS NULL OR api_key_ref ~ '^[A-Z][A-Z0-9_]{0,63}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id                    text PRIMARY KEY,
  store_id              text NOT NULL REFERENCES stores (id),
  barcode               text NOT NULL,
  name                  text NOT NULL,
  category              text NOT NULL,

  -- Nullable: the aisle-traffic report falls back to `category`, so a store gets useful
  -- location insight before anyone has surveyed the shop.
  aisle                 text,

  image_url             text NOT NULL,
  unit_price            integer NOT NULL,
  expected_weight_grams integer NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,

  -- Commercially sensitive. Requirement 2 forbids any of these reaching a customer; that is
  -- enforced in `products/projection.ts`, which copies out an allowlist field by field.
  cost_price            integer NOT NULL,
  profit_margin_pct     real NOT NULL,
  supplier_name         text NOT NULL,
  supplier_contact      text NOT NULL,
  stock_quantity        integer NOT NULL,
  internal_sku          text NOT NULL,
  purchase_history      jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- The Requirement 3 hot path, and the constraint the in-memory barcode map was standing in
-- for. Two rows with the same barcode in one store would make a scan result depend on
-- iteration order.
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_idx
  ON products (store_id, barcode);

-- Serves both the operator listing and the paginated customer search, which order by name.
CREATE INDEX IF NOT EXISTS products_store_name_idx
  ON products (store_id, name);

CREATE SEQUENCE IF NOT EXISTS product_id_seq AS bigint START 1;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id                    text PRIMARY KEY,
  store_id              text NOT NULL REFERENCES stores (id),

  -- The anonymous shopping session, not a customer identity.
  session_id            text NOT NULL,
  status                text NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'abandoned')),

  subtotal_paise        integer NOT NULL,
  discount_paise        integer NOT NULL,
  platform_fee_paise    integer NOT NULL,
  total_paise           integer NOT NULL,

  -- Cost of goods, for the margin figure on the owner's dashboard. Internal only.
  total_cost_paise      integer NOT NULL,
  expected_weight_grams integer NOT NULL,

  -- Epoch milliseconds, matching the domain type exactly. Storing these as `timestamptz`
  -- would round-trip through two conversions for no benefit, and the application compares
  -- them against `Date.now()`.
  created_at            bigint NOT NULL,
  paid_at               bigint,

  payee_vpa             text,
  payee_name            text,
  transaction_ref       text NOT NULL,
  confirmation          text NOT NULL
    CHECK (confirmation IN ('unconfirmed', 'customer_attested', 'staff_verified', 'psp_webhook', 'in_store_tender'))
);

-- Ownership lookup: `findForSession` is what stops one customer reading another's basket.
CREATE INDEX IF NOT EXISTS orders_session_idx ON orders (session_id);
CREATE INDEX IF NOT EXISTS orders_store_created_idx ON orders (store_id, created_at DESC);

-- Lines get their own table rather than a jsonb blob on the order: "how many units of X did
-- we sell" is the whole reason for collecting them, and that query wants rows.
CREATE TABLE IF NOT EXISTS order_lines (
  order_id              text NOT NULL REFERENCES orders (id) ON DELETE CASCADE,

  -- Position within the order. Part of the key so line ordering survives a round trip
  -- rather than depending on whatever order the planner returns.
  line_no               integer NOT NULL,

  product_id            text NOT NULL,
  barcode               text NOT NULL,

  -- Name and prices are copied, not joined. An event records what was true when it
  -- happened: re-pricing an item next week must not restate last week's revenue.
  name                  text NOT NULL,
  quantity              integer NOT NULL,
  unit_price_paise      integer NOT NULL,
  line_paise            integer NOT NULL,
  unit_cost_paise       integer NOT NULL,
  line_cost_paise       integer NOT NULL,
  expected_weight_grams integer NOT NULL,

  PRIMARY KEY (order_id, line_no)
);

-- ---------------------------------------------------------------------------
-- Analytics event log
-- ---------------------------------------------------------------------------

-- Append-only and immutable. The dashboard is a read model over this, never a set of
-- counters mutated in place: a counter that drifts cannot be reconciled, whereas an event
-- log can be re-aggregated when a metric definition changes.
CREATE TABLE IF NOT EXISTS store_events (
  id          text PRIMARY KEY,

  -- Append order, used only as a tiebreak. `occurred_at` has millisecond resolution and a
  -- session that starts and ends inside the same millisecond is not hypothetical in tests.
  -- Without a monotonic tiebreak those two events could come back in either order, and the
  -- average-shopping-time calculation would read a negative duration.
  seq         bigserial NOT NULL,

  store_id    text NOT NULL REFERENCES stores (id),
  session_id  text NOT NULL,
  kind        text NOT NULL
    CHECK (kind IN ('session_started', 'session_ended', 'product_scanned', 'scan_missed', 'order_placed')),
  occurred_at bigint NOT NULL,

  -- The kind-specific fields. Kept as jsonb rather than thirty mostly-null columns, since
  -- every query filters by store and window first and reads the payload afterwards.
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- The only index that matters: every dashboard query is "this store, this window".
CREATE INDEX IF NOT EXISTS store_events_store_occurred_idx
  ON store_events (store_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
--
-- SnapUp's own data, not the retailer's. Who may sign in is our question, so unlike
-- products and orders there is no retailer-API backend for this table — an outage at one
-- branch must not lock staff out of the console for all eight.
--
-- Nothing here is ever deleted. Orders and analytics reference a user id, and "who
-- approved this refund" has to stay answerable, so removal is `is_active = false`.

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,

  role          text NOT NULL DEFAULT 'customer'
    CHECK (role IN ('owner', 'manager', 'staff', 'customer')),

  -- E.164 digits, no '+'. The customer app signs in by phone and OTP, so for a customer
  -- this is their whole identity. Staff may have one too — that is how an owner signs in
  -- to the customer app as well as the console.
  phone         text UNIQUE,

  -- Console identity. Customers normally have none.
  email         text UNIQUE,

  -- scrypt, as 'scrypt$N$r$p$salt$hash'. NULL for phone-only accounts: there is no
  -- password to steal from an account that has never had one.
  password_hash text,

  name          text,

  -- Branch this staff member belongs to. Recorded now so that when per-branch scoping is
  -- enforced, the data already exists rather than having to be reconstructed from memory.
  store_id      text REFERENCES stores (id),

  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,

  -- An account has to be reachable by something, or it can never sign in.
  CONSTRAINT users_have_an_identifier CHECK (phone IS NOT NULL OR email IS NOT NULL),

  -- A console role must be able to use the console, which means email + password.
  CONSTRAINT staff_can_sign_in CHECK (
    role = 'customer' OR (email IS NOT NULL AND password_hash IS NOT NULL)
  )
);

-- Case-insensitive email uniqueness. The UNIQUE above is case-sensitive, so without this
-- 'Owner@shop.in' and 'owner@shop.in' would be two accounts that both look correct.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role) WHERE role <> 'customer';

-- ---------------------------------------------------------------------------
-- One-time codes
-- ---------------------------------------------------------------------------
--
-- The code is stored HASHED and peppered with a server-side secret. A challenge row is a
-- live credential until it expires; plaintext here would let anyone with read access to
-- the database sign in as any customer who happened to be mid-login. Six digits is only a
-- million candidates, so the pepper — held in the environment, never in this table — is
-- what makes a leaked dump useless.

CREATE TABLE IF NOT EXISTS otp_challenges (
  id          text PRIMARY KEY,
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,

  -- Capped in the application. Unlimited guesses against a five-minute window would make
  -- six digits entirely brute-forceable.
  attempts    integer NOT NULL DEFAULT 0,

  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Serves the only query on this table: newest live challenge for a number.
CREATE INDEX IF NOT EXISTS otp_challenges_phone_idx
  ON otp_challenges (phone, created_at DESC) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Password resets
-- ---------------------------------------------------------------------------
--
-- Console accounts only. Customers sign in with a phone and a one-time code, so there is
-- no password to forget and nothing here ever applies to them — which is a genuine
-- security property rather than a gap: the most commonly abused account-recovery flow
-- simply does not exist for the larger population.
--
-- The token is stored HASHED, for the same reason the OTP is. A reset row is a live
-- credential capable of taking over an owner account until it expires; anyone with read
-- access to this table could otherwise walk straight in. Unlike the OTP the token is
-- long and random, so a plain SHA-256 is sufficient — there is no candidate space to
-- brute-force.

CREATE TABLE IF NOT EXISTS password_resets (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,

  -- One hour. Long enough to find the message and act on it, short enough that a link
  -- left sitting in an inbox is not a standing key to the console.
  expires_at timestamptz NOT NULL,

  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Recorded so a reset can be traced afterwards. Not used as an access control input:
  -- a legitimate user routinely requests from one network and completes from another.
  requested_ip text
);

-- Serves both queries on this table: "is this token live" and "invalidate this user's
-- outstanding resets".
CREATE INDEX IF NOT EXISTS password_resets_user_idx
  ON password_resets (user_id, created_at DESC) WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS password_resets_token_idx ON password_resets (token_hash);

-- ---------------------------------------------------------------------------
-- Orders: staff payment verification
-- ---------------------------------------------------------------------------
--
-- Under the direct-to-merchant UPI model no payment provider ever tells us a transfer
-- happened, so the only evidence available is a member of staff looking at the shop's own
-- UPI app and saying yes. These columns record who did that and when.
--
-- Attribution is the entire point. "The gate opened and the money never arrived" has to be
-- answerable, and an anonymous boolean cannot answer it. `verified_by` references a real
-- user, which is why removing a staff member deactivates rather than deletes them.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by   text REFERENCES users (id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at   bigint;

-- Short, human-typeable handle the customer shows at the exit. Six characters from an
-- unambiguous alphabet: staff read it off a phone screen under fluorescent light and type
-- it on a till, so O/0 and I/1 are excluded rather than trusted to context.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verification_code text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_verification_code_idx
  ON orders (verification_code) WHERE verification_code IS NOT NULL;

-- 'awaiting_verification' sits between a customer's claim and a staff confirmation. It
-- exists so the two are never conflated: an order in this state has been attested and not
-- verified, which is exactly the distinction the exit gate depends on.
DO $$
BEGIN
  ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
  ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('awaiting_payment', 'awaiting_verification', 'paid', 'abandoned'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Orders: ownership
-- ---------------------------------------------------------------------------
--
-- An order is created against an anonymous *shopping* session, which is deliberate: the
-- catalogue must be usable without an account. But "My Bills" has to survive that session
-- ending, and a shopper who signs in should see their history on a new phone.
--
-- Nullable, because a guest checkout is a legitimate outcome and has no account to attach.
-- Those bills live only on the device that made them.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id text REFERENCES users (id);

CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON orders (user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Branch credentials: a key that can be pasted but never read back
-- ---------------------------------------------------------------------------
--
-- `api_key_ref` names an environment variable and is the right answer for a deployment
-- somebody operates with a terminal. It is the wrong answer for a pilot, where the person
-- running the shop cannot edit the hosting environment — so the console needs a field they
-- can paste a key into.
--
-- What is stored is the ciphertext, never the key. `api_key_masked` and
-- `api_key_fingerprint` are what the console renders: together they answer "is a key set"
-- and "is it still the one I pasted" without the secret leaving the server. See
-- `stores/credentials.ts` for the format and its limits.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_key_sealed      text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_key_masked      text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_key_fingerprint text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS api_key_set_at      bigint;

-- ---------------------------------------------------------------------------
-- Orders: the weight check at the exit
-- ---------------------------------------------------------------------------
--
-- The basket's expected weight is already computed from the catalogue at order time. This
-- records what the scale at the exit actually read, so the two can be compared by a member
-- of staff before the customer leaves.
--
-- `weight_override_by` is the column that matters. A basket can disagree with its expected
-- weight for entirely innocent reasons — packaged goods vary from their printed weight,
-- scales drift, produce is weighed at a counter — and a check that strands a paying
-- customer at the gate with no recourse is worse than one that can be overridden. So staff
-- may approve a mismatch, and doing so writes down who did it and by how much. That record
-- is the whole safeguard: an override nobody can attribute is indistinguishable from no
-- check at all.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS observed_weight_grams integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_checked_by     text REFERENCES users (id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_checked_at     bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_override_by    text REFERENCES users (id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exit_approved_at      bigint;

-- ---------------------------------------------------------------------------
-- Stores: opening hours
-- ---------------------------------------------------------------------------
--
-- Minutes since local midnight, 0–1439. Not a timestamp and not a time zone: a shop opens
-- at nine in the morning where it stands, and every branch here is in one country. Storing
-- wall-clock minutes keeps "09:00" the same string the owner typed, through every backup
-- and restore, with no offset arithmetic to get wrong twice a year.
--
-- Nullable, because a branch is registered before anyone confirms its hours, and because
-- some shops genuinely do not keep fixed ones. Null means "hours not stated" — the
-- directory then falls back to the manual `is_open` flag rather than inventing a schedule.
--
-- `closes_at_minutes` less than `opens_at_minutes` means the shop closes after midnight
-- (22:00–02:00). That is a real case for a metro bazaar and the comparison has to allow
-- for it, so it is written down here rather than discovered as a bug at 1am.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS opens_at_minutes  integer;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS closes_at_minutes integer;

DO $$ BEGIN
  ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_hours_range_check;
  ALTER TABLE stores ADD CONSTRAINT stores_hours_range_check
    CHECK (
      (opens_at_minutes  IS NULL OR (opens_at_minutes  >= 0 AND opens_at_minutes  <= 1439)) AND
      (closes_at_minutes IS NULL OR (closes_at_minutes >= 0 AND closes_at_minutes <= 1439))
    );
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Keep store_id_seq ahead of the ids already in the table
-- ---------------------------------------------------------------------------
--
-- `create()` mints ids as 'store_' || nextval('store_id_seq'), but the CSV importer writes
-- ids straight from the sheet — store_1, store_2 — and an explicit insert does not advance
-- a sequence. So after any import the sequence still points at 1, and the first shop
-- registered through the console dies on:
--
--     duplicate key value violates unique constraint "stores_pkey"
--
-- which reads as a bug in signup rather than as a sequence that was never caught up.
--
-- Idempotent, and safe to run on every migration: it only ever moves the sequence forward,
-- to the highest numeric suffix present. Ids with no digits are ignored rather than
-- treated as zero.
SELECT setval(
  'store_id_seq',
  GREATEST(
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '[^0-9]', '', 'g'), '')::bigint), 0) FROM stores),
    1
  )
);

-- ---------------------------------------------------------------------------
-- Customer identity: username and password
-- ---------------------------------------------------------------------------
--
-- The pilot spec excludes OTP and asks for basic username/password sign-in, so a customer
-- now needs an identifier that is neither a phone number nor a work email. `username` is
-- that identifier.
--
-- Stored case-folded in a separate column rather than lower-cased in place, because the
-- name a person typed is the one they should see on their own account. `username_folded`
-- is what uniqueness and lookup use, so "Dharsan" and "dharsan" cannot both be registered
-- while the display keeps whichever was chosen.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username        text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_folded text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_folded_idx
  ON users (username_folded) WHERE username_folded IS NOT NULL;

-- The original constraint predates usernames and required a phone or an email. A pilot
-- customer now has neither: the specification excludes OTP, so they register with a
-- username and a password and are asked for nothing else. Widened rather than dropped —
-- an account reachable by nothing at all still cannot sign in, and that is worth refusing
-- at the table rather than discovering as a support call.
DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_have_an_identifier;
  ALTER TABLE users ADD CONSTRAINT users_have_an_identifier
    CHECK (phone IS NOT NULL OR email IS NOT NULL OR username_folded IS NOT NULL);
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Products: brand, MRP and the Snap Up discount
-- ---------------------------------------------------------------------------
--
-- The supplied catalogue carries four money figures per item: MRP, Sell, Discount and
-- Final. They are not interchangeable and the pilot checkout depends on the difference.
--
--   mrp_paise       the printed maximum price, shown struck through
--   unit_price      what anybody pays -- the catalogue's "Sell"
--   discount_paise  the Snap Up discount, applied only to a signed-in customer
--
-- Section 3 of the pilot specification makes that last distinction load-bearing: a guest
-- sees "Snap Up Discount ₹0 — Login to redeem" and the same basket costs less once they
-- sign in. Storing only a final price would make that impossible to express, and storing
-- a percentage would let guest and member totals disagree by a rounding paisa.
--
-- Derived as Sell − Final rather than read from the "Discount" column, which appears as a
-- flat rupee amount, a percentage, or "None" depending on the row. One subtraction is
-- exact for all three.
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand          text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp_paise      integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_paise integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE products DROP CONSTRAINT IF EXISTS products_discount_not_negative;
  ALTER TABLE products ADD CONSTRAINT products_discount_not_negative
    CHECK (discount_paise >= 0);
EXCEPTION WHEN others THEN NULL;
END $$;
