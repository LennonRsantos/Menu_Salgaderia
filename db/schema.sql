-- Salgaderia schema (Lakebase Postgres on Neon). Idempotent: `npm run db:migrate`
-- can run any number of times. Users and sessions live in the `neon_auth`
-- schema managed by Neon Auth; `staff` says who may use the panel.

create table if not exists store_settings (
  id            int primary key default 1 check (id = 1),
  name          text not null default 'Menu Salgaderia e Confeitaria',
  tagline       text,
  phone         text,
  logo_url      text,
  delivery_fee  numeric(10, 2) not null default 0 check (delivery_fee >= 0),
  min_order     numeric(10, 2) not null default 0 check (min_order >= 0),
  is_open       boolean not null default true,
  opening_hours text,
  updated_at    timestamptz not null default now()
);

-- Panel access. user_id is neon_auth."user".id; an account without a row here
-- (or with active = false) can sign in to Neon Auth but reaches nothing.
create table if not exists staff (
  user_id    text primary key,
  full_name  text not null,
  email      text not null,
  role       text not null check (role in ('admin', 'staff')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  position  int not null default 0,
  is_active boolean not null default true
);

-- Addon groups are stored inside the product row (jsonb) so a product edit is
-- one atomic write: [{ id, name, min_select, max_select, position,
--                     addons: [{ id, name, price, is_available, position }] }]
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references categories (id) on delete restrict,
  name         text not null,
  description  text,
  price        numeric(10, 2) not null check (price >= 0),
  image_url    text,
  is_visible   boolean not null default true,
  is_available boolean not null default true,
  position     int not null default 0,
  addon_groups jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists products_category_idx on products (category_id);

create table if not exists customers (
  phone        text primary key,
  name         text not null,
  last_address jsonb,
  orders_count int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists customer_addresses (
  id             bigint generated always as identity primary key,
  customer_phone text not null references customers (phone) on delete cascade,
  address        jsonb not null,
  created_at     timestamptz not null default now()
);

create sequence if not exists order_code_seq start 1001;

-- Orders keep a snapshot of names, prices and addons (items jsonb), so menu
-- edits never change past orders.
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  code           int not null unique default nextval('order_code_seq'),
  public_token   uuid not null unique default gen_random_uuid(),
  customer_phone text not null references customers (phone),
  customer_name  text not null,
  address        jsonb,
  fulfillment    text not null check (fulfillment in ('delivery', 'pickup')),
  payment_method text not null check (payment_method in ('pix', 'credit', 'debit', 'cash')),
  change_for     numeric(10, 2),
  status         text not null default 'new'
                 check (status in ('new', 'preparing', 'out_for_delivery', 'completed', 'cancelled')),
  items          jsonb not null,
  subtotal       numeric(10, 2) not null,
  delivery_fee   numeric(10, 2) not null,
  total          numeric(10, 2) not null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  dispatched_at  timestamptz,
  completed_at   timestamptz,
  cancelled_at   timestamptz
);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_idx on orders (created_at);

-- Photos uploaded from the panel (products and store logo). The browser shrinks
-- them before upload, so rows stay small; GET /api/images/<id> serves them with
-- an immutable cache header, since a new photo always gets a new id.
create table if not exists images (
  id           uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('image/webp', 'image/jpeg', 'image/png')),
  data         bytea not null check (octet_length(data) <= 800000),
  created_at   timestamptz not null default now()
);

-- Stock. Items have their own categories (they may never appear on the menu,
-- e.g. boxes). stock_links say what one unit of a product, or of one of its
-- addons, consumes; a product without links sells without limit.
create table if not exists stock_categories (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  position int not null default 0
);

create table if not exists stock_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references stock_categories (id) on delete restrict,
  name         text not null,
  unit         text not null default 'un',
  quantity     numeric(10, 2) not null default 0,
  min_quantity numeric(10, 2) not null default 0 check (min_quantity >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists stock_items_category_idx on stock_items (category_id);

-- addon_id null: the product itself; otherwise the addon id inside products.addon_groups.
create table if not exists stock_links (
  id         bigint generated always as identity primary key,
  product_id uuid not null references products (id) on delete cascade,
  addon_id   text,
  item_id    uuid not null references stock_items (id) on delete restrict,
  quantity   numeric(10, 2) not null check (quantity > 0)
);
create index if not exists stock_links_product_idx on stock_links (product_id);
create index if not exists stock_links_item_idx on stock_links (item_id);

-- Every change of stock_items.quantity, so cancelling an order returns exactly
-- what its sale took, even if the links changed since.
create table if not exists stock_movements (
  id         bigint generated always as identity primary key,
  item_id    uuid not null references stock_items (id) on delete cascade,
  delta      numeric(10, 2) not null,
  reason     text not null check (reason in ('sale', 'cancel', 'restock', 'adjust')),
  order_id   uuid references orders (id) on delete set null,
  user_name  text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on stock_movements (item_id, created_at desc);
create index if not exists stock_movements_order_idx on stock_movements (order_id);

-- Opening hours: [{ day: 0..6 (0 = Sunday), open: "HH:MM", close: "HH:MM" }].
-- With auto_hours the store follows them; is_open stays as the manual pause.
alter table store_settings add column if not exists hours jsonb not null default '[]'::jsonb;
alter table store_settings add column if not exists auto_hours boolean not null default false;
-- Neighborhoods outside delivery_zones: charged delivery_fee when true, refused when false.
alter table store_settings add column if not exists other_zones boolean not null default true;
-- Scheduled orders (encomendas).
alter table store_settings add column if not exists schedule_enabled boolean not null default false;
alter table store_settings add column if not exists schedule_min_hours int not null default 24 check (schedule_min_hours between 0 and 720);
alter table store_settings add column if not exists schedule_max_days int not null default 30 check (schedule_max_days between 1 and 180);

create table if not exists delivery_zones (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  fee      numeric(10, 2) not null check (fee >= 0),
  position int not null default 0
);

-- null: as soon as possible. Scheduled orders take stock when accepted, not when placed.
alter table orders add column if not exists scheduled_for timestamptz;
create index if not exists orders_scheduled_idx on orders (scheduled_for) where scheduled_for is not null;

-- Unit cost, for the dashboard's cost of goods and margins. Movements keep the
-- cost of the moment, so later price changes don't rewrite past profit.
alter table stock_items add column if not exists cost numeric(10, 2) not null default 0 check (cost >= 0);
alter table stock_movements add column if not exists unit_cost numeric(10, 2);

-- Store address, estimated times (minutes) and which fulfillment modes are on.
alter table store_settings add column if not exists address text;
alter table store_settings add column if not exists delivery_enabled boolean not null default true;
alter table store_settings add column if not exists pickup_enabled boolean not null default true;
alter table store_settings add column if not exists delivery_min int check (delivery_min between 0 and 600);
alter table store_settings add column if not exists delivery_max int check (delivery_max between 0 and 600);
alter table store_settings add column if not exists pickup_min int check (pickup_min between 0 and 600);
alter table store_settings add column if not exists pickup_max int check (pickup_max between 0 and 600);

-- Most orders one 30-minute scheduling slot takes; null = no limit.
alter table store_settings add column if not exists slot_capacity int check (slot_capacity between 1 and 500);

-- Customer accounts (Neon Auth). Kept apart from the phone-keyed customers base:
-- signing up with someone else's number never exposes their past orders.
create table if not exists customer_accounts (
  user_id             text primary key,
  name                text not null,
  phone               text not null unique,
  email               text not null,
  birthday            date,
  referral_source     text,
  marketing_opt_in    boolean not null default false,
  marketing_opt_in_at timestamptz,
  privacy_accepted_at timestamptz not null,
  addresses           jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Internal notes about a customer (also for those who order without an account).
alter table customers add column if not exists staff_notes text;
-- Set when the order was placed while signed in to a customer account.
alter table orders add column if not exists customer_user_id text;
create index if not exists orders_customer_user_idx on orders (customer_user_id);
create index if not exists orders_customer_phone_idx on orders (customer_phone);

-- The store's own special dates (local festivities, anniversaries), shown next
-- to the national holidays when customers book a day.
create table if not exists special_dates (
  id    uuid primary key default gen_random_uuid(),
  date  date not null,
  title text not null
);

-- Costs (admin only). Kept apart from stock: recipes only price the products,
-- sales never take ingredients. A unit cost is package_price / package_size.
create table if not exists cost_inputs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null check (kind in ('ingredient', 'packaging', 'other')),
  unit          text not null default 'un',
  package_size  numeric(12, 4) not null default 1 check (package_size > 0),
  package_price numeric(10, 2) not null default 0 check (package_price >= 0),
  supplier      text,
  updated_at    timestamptz not null default now()
);

-- Every price an input had, newest last.
create table if not exists cost_input_prices (
  id            bigint generated always as identity primary key,
  input_id      uuid not null references cost_inputs (id) on delete cascade,
  package_size  numeric(12, 4) not null,
  package_price numeric(10, 2) not null,
  user_name     text,
  created_at    timestamptz not null default now()
);
create index if not exists cost_input_prices_input_idx on cost_input_prices (input_id, created_at desc);

-- Ficha técnica: one per menu product. The recipe makes `yield` units;
-- include_fixed adds the product's share of the monthly expenses.
create table if not exists product_costs (
  product_id    uuid primary key references products (id) on delete cascade,
  yield         numeric(10, 2) not null default 1 check (yield > 0),
  include_fixed boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- An input line (input_id + quantity) or a free line (label + amount in R$),
-- for the whole recipe ('batch', divided by yield) or for each unit.
create table if not exists product_cost_lines (
  id         bigint generated always as identity primary key,
  product_id uuid not null references product_costs (product_id) on delete cascade,
  input_id   uuid references cost_inputs (id) on delete restrict,
  label      text,
  quantity   numeric(12, 4),
  amount     numeric(10, 4),
  per        text not null default 'batch' check (per in ('batch', 'unit')),
  position   int not null default 0,
  check ((input_id is not null and quantity > 0) or (input_id is null and label is not null and amount >= 0))
);
create index if not exists product_cost_lines_product_idx on product_cost_lines (product_id);
create index if not exists product_cost_lines_input_idx on product_cost_lines (input_id);

-- Operating expenses: every month (recurring) or once, on `date`.
create table if not exists operating_expenses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null check (category in ('gas', 'energy', 'water', 'rent', 'staff', 'internet', 'marketing', 'taxes', 'maintenance', 'other')),
  amount     numeric(10, 2) not null check (amount >= 0),
  recurring  boolean not null default true,
  date       date,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  check (recurring or date is not null)
);

-- monthly_units: units made per month, to share the expenses (null = units sold
-- in the last 30 days). sales_pct: taxes and card fees, as % of the price.
create table if not exists cost_settings (
  id            int primary key default 1 check (id = 1),
  monthly_units int check (monthly_units > 0),
  target_margin int not null default 60 check (target_margin between 1 and 95),
  sales_pct     numeric(5, 2) not null default 0 check (sales_pct between 0 and 50)
);
insert into cost_settings (id) values (1) on conflict do nothing;

-- Appearance: color palette and festive theme (see src/lib/themes.ts). A festive
-- theme ('auto' follows the calendar) replaces the palette while it lasts.
alter table store_settings add column if not exists theme_palette text not null default 'purple'
  check (theme_palette in ('purple', 'wine', 'green', 'blue', 'terracotta'));
alter table store_settings add column if not exists festive_mode text not null default 'off'
  check (festive_mode in ('off', 'auto', 'christmas', 'newyear', 'carnival'));
-- Banner text on the menu; null = the theme's default message.
alter table store_settings add column if not exists festive_message text;
alter table store_settings add column if not exists festive_effects boolean not null default true;

-- Background photo of the menu header, uploaded in the panel (like logo_url).
alter table store_settings add column if not exists header_image_url text;

-- Customers may book up to 60 days ahead by default (still 1..180 in the panel).
alter table store_settings alter column schedule_max_days set default 60;

-- CEP of the store address (digits), so the panel can look it up again.
alter table store_settings add column if not exists address_zip text;

-- Per-IP limit for public actions (src/lib/rate-limit.ts). key = scope + hash
-- of the IP, never the IP itself; rows older than a day are cleaned up.
create table if not exists rate_hits (
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists rate_hits_key_idx on rate_hits (key, at);

-- Pages each person pins to the phone bar and tablet rail (src/lib/nav.ts);
-- null = the default ones.
alter table staff add column if not exists nav_pins text[];

-- Profile photo each person sets in "Minha conta" (/api/images/<id>).
alter table staff add column if not exists avatar_url text;

-- When each person finished (or skipped) the panel's first-access tour; null =
-- still to see it. Accounts that existed before the tour get "now" (they already
-- know the panel); dropping the default makes new accounts start null.
alter table staff add column if not exists tour_done_at timestamptz default now();
alter table staff alter column tour_done_at drop default;

-- Dashboard blocks each manager shows, their order and width, and the period it
-- opens with (src/lib/dashboard-layout.ts); null = the default layout.
alter table staff add column if not exists dashboard_layout jsonb;

-- Discount coupons (admin "Cupons" tab, src/lib/coupons.ts). A coupon is used
-- at most once per customer (WhatsApp, and account when signed in) and at most
-- max_uses times in total (null = no limit). Cancelling an order keeps the use.
create table if not exists coupons (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  kind       text not null check (kind in ('percent', 'amount')),
  value      numeric(10, 2) not null check (value > 0),
  max_uses   int check (max_uses >= 1),
  expires_on date not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);
create unique index if not exists coupons_code_idx on coupons (code);

create table if not exists coupon_redemptions (
  id               bigint generated always as identity primary key,
  coupon_id        uuid not null references coupons (id) on delete restrict,
  order_id         uuid not null references orders (id) on delete cascade,
  customer_phone   text not null,
  customer_user_id text,
  created_at       timestamptz not null default now(),
  unique (coupon_id, customer_phone)
);
create unique index if not exists coupon_redemptions_user_idx
  on coupon_redemptions (coupon_id, customer_user_id) where customer_user_id is not null;

-- Discount on the products (never on the delivery fee); total is already net of it.
alter table orders add column if not exists discount numeric(10, 2) not null default 0 check (discount >= 0);
alter table orders add column if not exists coupon_code text;

-- Birthday banner on the Dashboard (days_before = 0: only on the day) and the
-- congratulation text; null = default message (src/lib/customer.ts).
alter table store_settings add column if not exists birthday_alert boolean not null default true;
alter table store_settings add column if not exists birthday_days_before int not null default 0
  check (birthday_days_before between 0 and 30);
alter table store_settings add column if not exists birthday_message text;

-- Days ahead the panel's Encomendas page shows by default (1..180).
alter table store_settings add column if not exists schedule_view_days int not null default 60
  check (schedule_view_days between 1 and 180);

-- Sale units (Configurações > Cardápio) and the one each product is sold by
-- (null = no label). Plain text on the product, so removing a unit from the
-- list never breaks a product.
alter table store_settings add column if not exists sale_units text[] not null default '{unidade,dezena,centena}';
alter table products add column if not exists sale_unit text;
