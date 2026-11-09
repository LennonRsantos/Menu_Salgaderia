"use server";

import type { QueryResultRow } from "pg";
import { requireAdmin } from "@/lib/auth";
import { variableCost } from "@/lib/costs";
import { loadInputPrices, loadRecipes } from "@/lib/costs-db";
import { layoutError, PARTS, resolveLayout, type Part } from "@/lib/dashboard-layout";
import { query } from "@/lib/db";
import type { DashboardLayout, PaymentMethod } from "@/types";

export interface Metrics {
  today_revenue: number;
  today_orders: number;
  /** Yesterday up to the same time of day, for a fair comparison. */
  yesterday_revenue: number;
  month_revenue: number;
  month_orders: number;
  /** Previous month up to the same day and time. */
  prev_month_revenue: number;
  range_revenue: number;
  range_orders: number;
  prev_range_revenue: number;
  prev_range_orders: number;
  open_orders: number;
  /** Stock items at or below their minimum (including empty ones). */
  low_stock: number;
  out_of_stock: number;
}
export interface DayPoint {
  day: string;
  revenue: number;
  orders: number;
}
export interface TopProduct {
  product_name: string;
  quantity: number;
  revenue: number;
}
export interface Profit {
  /** Items only: delivery fees are not product sales. */
  items_revenue: number;
  cost: number;
  /** Share of items revenue from orders that carried a cost. */
  covered_revenue: number;
  /** Operating expenses of the range: monthly ones pro rata, plus one-off ones dated in it. */
  fixed_expenses: number;
  margins: { name: string; price: number; cost: number }[];
}
export interface HeatCell {
  dow: number;
  hour: number;
  orders: number;
}
export interface Times {
  accept_min: number | null;
  prep_min: number | null;
  delivery_min: number | null;
  orders: number;
  cancelled: number;
  cancelled_value: number;
}
export interface CustomerRow {
  name: string;
  phone: string;
  orders: number;
  total: number;
  last_order: string;
}
export interface Customers {
  new_count: number;
  returning_count: number;
  top: CustomerRow[];
  /** 2+ orders and none in the last 30 days. */
  lost: CustomerRow[];
}
export interface Neighborhood {
  name: string;
  orders: number;
  revenue: number;
}

export interface BirthdayRow {
  name: string;
  phone: string;
  /** "YYYY-MM-DD" */
  birthday: string;
  /** 0 = today. */
  days_left: number;
}

/** What the Dashboard shows. A part that was not asked for comes back null. */
export interface DashboardData {
  metrics: Metrics | null;
  series: DayPoint[] | null;
  top: TopProduct[] | null;
  profit: Profit | null;
  heat: HeatCell[] | null;
  times: Times | null;
  customers: Customers | null;
  neighborhoods: Neighborhood[] | null;
  /** Loaded with the customers or the birthdays. */
  store_name: string | null;
  /** Customers with a birthday within the window set in the panel; empty when the alert is off. */
  birthdays: BirthdayRow[] | null;
  birthday_message: string | null;
}

export type DashboardResult = { ok: true; data: DashboardData } | { ok: false; error: string };

// All day boundaries use the store's time zone.
const LOCAL = "(now() at time zone 'America/Sao_Paulo')";
const local = (column: string) => `(${column} at time zone 'America/Sao_Paulo')`;
// first day of the selected range ($1 = number of days)
const START = `(date_trunc('day', ${LOCAL}) - ($1::int - 1) * interval '1 day')`;
const IN_RANGE = (column: string) => `${local(column)} >= ${START}`;

/**
 * Admin only. Sales exclude cancelled orders. Only the `parts` asked for are
 * queried (the blocks each manager shows); the others come back null.
 */
export async function getDashboard(days: number, parts: readonly string[] = PARTS): Promise<DashboardResult> {
  try {
    await requireAdmin();
    const range = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
    const want = new Set(parts.filter((p): p is Part => (PARTS as readonly string[]).includes(p)));
    const has = (p: Part) => want.has(p);
    // a part nobody shows skips its query and gets no rows
    const part = <T extends QueryResultRow>(p: Part, text: string, params: unknown[]) => (has(p) ? query<T>(text, params) : Promise.resolve<T[]>([]));

    const [[m], series, top, [profit], margins, heat, [times], [customerCounts], topCustomers, lost, neighborhoods, [store], birthdays] = await Promise.all([
      part<Metrics>(
        "metrics",
        `select
           coalesce(sum(total) filter (where ${local("created_at")} >= date_trunc('day', ${LOCAL})), 0) as today_revenue,
           count(*) filter (where ${local("created_at")} >= date_trunc('day', ${LOCAL})) as today_orders,
           coalesce(sum(total) filter (where ${local("created_at")} >= date_trunc('day', ${LOCAL}) - interval '1 day'
                                         and ${local("created_at")} < ${LOCAL} - interval '1 day'), 0) as yesterday_revenue,
           coalesce(sum(total) filter (where ${local("created_at")} >= date_trunc('month', ${LOCAL})), 0) as month_revenue,
           count(*) filter (where ${local("created_at")} >= date_trunc('month', ${LOCAL})) as month_orders,
           coalesce(sum(total) filter (where ${local("created_at")} >= date_trunc('month', ${LOCAL}) - interval '1 month'
                                         and ${local("created_at")} < ${LOCAL} - interval '1 month'), 0) as prev_month_revenue,
           coalesce(sum(total) filter (where ${IN_RANGE("created_at")}), 0) as range_revenue,
           count(*) filter (where ${IN_RANGE("created_at")}) as range_orders,
           coalesce(sum(total) filter (where ${local("created_at")} >= ${START} - $1::int * interval '1 day'
                                         and ${local("created_at")} < ${START}), 0) as prev_range_revenue,
           count(*) filter (where ${local("created_at")} >= ${START} - $1::int * interval '1 day'
                              and ${local("created_at")} < ${START}) as prev_range_orders,
           (select count(*) from orders where status in ('new', 'preparing', 'out_for_delivery')) as open_orders,
           (select count(*) from stock_items where quantity <= min_quantity or quantity <= 0) as low_stock,
           (select count(*) from stock_items where quantity <= 0) as out_of_stock
         from orders where status <> 'cancelled'`,
        [range],
      ),
      part<DayPoint>(
        "series",
        `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(o.total), 0) as revenue, count(o.id) as orders
         from generate_series(${START}, date_trunc('day', ${LOCAL}), interval '1 day') d
         left join orders o on o.status <> 'cancelled' and date_trunc('day', ${local("o.created_at")}) = d
         group by d order by d`,
        [range],
      ),
      part<TopProduct>(
        "top",
        `select i->>'product_name' as product_name, sum((i->>'quantity')::int) as quantity, sum((i->>'line_total')::numeric) as revenue
         from orders o, jsonb_array_elements(o.items) i
         where o.status <> 'cancelled' and ${IN_RANGE("o.created_at")}
         group by 1 order by quantity desc, revenue desc limit 6`,
        [range],
      ),
      // cost of goods at the cost of the moment: the item costs kept in the order
      // (fichas técnicas), or, for older orders, what the sale took from stock
      part<Omit<Profit, "margins">>(
        "profit",
        `with sold as (
           -- coupon discounts come off the products' revenue
           select o.subtotal - o.discount as subtotal,
                  case when exists (select 1 from jsonb_array_elements(o.items) i where i ? 'unit_cost')
                       then (select coalesce(sum((i->>'unit_cost')::numeric * (i->>'quantity')::int), 0) from jsonb_array_elements(o.items) i)
                       else (select coalesce(sum(-m.delta * coalesce(m.unit_cost, 0)), 0) from stock_movements m
                              where m.order_id = o.id and m.reason in ('sale', 'cancel'))
                  end as cost
             from orders o
            where o.status <> 'cancelled' and ${IN_RANGE("o.created_at")})
         select coalesce(sum(subtotal), 0) as items_revenue, coalesce(round(sum(cost), 2), 0) as cost,
                coalesce(sum(subtotal) filter (where cost > 0), 0) as covered_revenue,
                (select round(coalesce(sum(amount * $1::int / 30.0) filter (where recurring and active), 0)
                              + coalesce(sum(amount) filter (where not recurring and date >= ${START}::date and date <= ${LOCAL}::date), 0), 2)
                   from operating_expenses) as fixed_expenses
           from sold`,
        [range],
      ),
      has("profit") ? productMargins() : Promise.resolve([]),
      part<HeatCell>(
        "heat",
        `select extract(dow from ${local("created_at")})::int as dow, extract(hour from ${local("created_at")})::int as hour, count(*) as orders
           from orders where status <> 'cancelled' and ${IN_RANGE("created_at")}
          group by 1, 2`,
        [range],
      ),
      // scheduled orders wait for their date by design, so they stay out of the service times
      part<Times>(
        "times",
        `select
           round(avg(extract(epoch from accepted_at - created_at)) filter (where scheduled_for is null and accepted_at is not null) / 60) as accept_min,
           round(avg(extract(epoch from dispatched_at - accepted_at)) filter (where scheduled_for is null and dispatched_at is not null and accepted_at is not null) / 60) as prep_min,
           round(avg(extract(epoch from completed_at - dispatched_at)) filter (where fulfillment = 'delivery' and completed_at is not null and dispatched_at is not null) / 60) as delivery_min,
           count(*) as orders,
           count(*) filter (where status = 'cancelled') as cancelled,
           coalesce(sum(total) filter (where status = 'cancelled'), 0) as cancelled_value
         from orders where ${IN_RANGE("created_at")}`,
        [range],
      ),
      part<{ new_count: number; returning_count: number }>(
        "customers",
        `with firsts as (select customer_phone, min(created_at) as first_at from orders where status <> 'cancelled' group by 1),
              buyers as (select distinct customer_phone from orders where status <> 'cancelled' and ${IN_RANGE("created_at")})
         select count(*) filter (where ${local("f.first_at")} >= ${START}) as new_count,
                count(*) filter (where ${local("f.first_at")} < ${START}) as returning_count
           from buyers b join firsts f using (customer_phone)`,
        [range],
      ),
      part<CustomerRow>(
        "customers",
        `select (array_agg(customer_name order by created_at desc))[1] as name, customer_phone as phone,
                count(*) as orders, sum(total) as total, max(created_at) as last_order
           from orders where status <> 'cancelled' and ${IN_RANGE("created_at")}
          group by customer_phone order by total desc, orders desc limit 5`,
        [range],
      ),
      part<CustomerRow>(
        "customers",
        `select (array_agg(customer_name order by created_at desc))[1] as name, customer_phone as phone,
                count(*) as orders, sum(total) as total, max(created_at) as last_order
           from orders where status <> 'cancelled'
          group by customer_phone
         having count(*) >= 2 and max(created_at) < now() - interval '30 days'
          order by total desc limit 8`,
        [],
      ),
      part<Neighborhood>(
        "neighborhoods",
        `select (array_agg(address->>'neighborhood' order by created_at desc))[1] as name, count(*) as orders, sum(total) as revenue
           from orders
          where status <> 'cancelled' and fulfillment = 'delivery' and ${IN_RANGE("created_at")}
            and coalesce(trim(address->>'neighborhood'), '') <> ''
          group by lower(trim(address->>'neighborhood'))
          order by orders desc, revenue desc limit 8`,
        [range],
      ),
      has("customers") || has("birthdays")
        ? query<{ name: string; birthday_message: string | null }>("select name, birthday_message from store_settings where id = 1")
        : Promise.resolve([]),
      // birthdays from today to birthday_days_before days ahead, in the store's time zone
      part<BirthdayRow>(
        "birthdays",
        `with s as (select birthday_alert, birthday_days_before from store_settings where id = 1),
              days as (select n, ${LOCAL}::date + n as d from s, generate_series(0, s.birthday_days_before) n where s.birthday_alert)
         select a.name, a.phone, to_char(a.birthday, 'YYYY-MM-DD') as birthday, min(days.n)::int as days_left
           from customer_accounts a
           join days on to_char(a.birthday, 'MM-DD') = to_char(days.d, 'MM-DD')
             -- 29/02 birthdays are greeted on 28/02 in non-leap years
             or (to_char(a.birthday, 'MM-DD') = '02-29' and to_char(days.d, 'MM-DD') = '02-28'
                 and extract(day from date_trunc('year', days.d) + interval '1 month 28 days') <> 29)
          group by a.user_id, a.name, a.phone, a.birthday
          order by days_left, a.name limit 20`,
        [],
      ),
    ]);

    const asDate = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    const withStore = has("customers") || has("birthdays");
    return {
      ok: true,
      data: {
        metrics: has("metrics") ? m : null,
        series: has("series") ? series : null,
        top: has("top") ? top : null,
        profit: has("profit") ? { ...profit, margins } : null,
        heat: has("heat") ? heat : null,
        times: has("times") ? times : null,
        customers: has("customers")
          ? {
              ...customerCounts,
              top: topCustomers.map((c) => ({ ...c, last_order: asDate(c.last_order) })),
              lost: lost.map((c) => ({ ...c, last_order: asDate(c.last_order) })),
            }
          : null,
        neighborhoods: has("neighborhoods") ? neighborhoods : null,
        store_name: withStore ? (store?.name ?? "loja") : null,
        birthdays: has("birthdays") ? birthdays : null,
        birthday_message: withStore ? (store?.birthday_message ?? null) : null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao carregar o dashboard." };
  }
}

/** Admin only. Saves the Dashboard the manager picked, on their own account; null goes back to the default. */
export async function saveDashboardLayout(layout: DashboardLayout | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const me = await requireAdmin();
    const error = layout && layoutError(layout);
    if (error) return { ok: false, error };
    // stored normalized: known blocks only, all of them, and a valid period
    const saved = layout && JSON.stringify(resolveLayout(layout));
    await query("update staff set dashboard_layout = $2::jsonb where user_id = $1", [me.id, saved]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível salvar o dashboard." };
  }
}

/** Current price minus the variable cost (ficha técnica, else stock links), lowest margins first. */
async function productMargins(): Promise<Profit["margins"]> {
  const [products, recipes, inputs, links] = await Promise.all([
    query<{ id: string; name: string; price: number }>("select id, name, price from products"),
    loadRecipes(query),
    loadInputPrices(query),
    query<{ product_id: string; cost: number }>(
      `select l.product_id, sum(l.quantity * i.cost) as cost
         from stock_links l join stock_items i on i.id = l.item_id where l.addon_id is null group by 1`,
    ),
  ]);
  const recipeOf = new Map(recipes.map((r) => [r.product_id, r]));
  const linkCost = new Map(links.map((l) => [l.product_id, Number(l.cost)]));
  const margin = (m: { price: number; cost: number }) => (m.price > 0 ? (m.price - m.cost) / m.price : -Infinity);
  return products
    .map((p) => {
      const recipe = recipeOf.get(p.id);
      return { name: p.name, price: p.price, cost: recipe ? variableCost(recipe, inputs).total : (linkCost.get(p.id) ?? 0) };
    })
    .filter((m) => m.cost > 0)
    .sort((a, b) => margin(a) - margin(b) || a.name.localeCompare(b.name))
    .slice(0, 10);
}

export interface CashClosing {
  date: string;
  /** Completed that day, by how they were paid: the money that came in. */
  received: { method: PaymentMethod; orders: number; total: number }[];
  delivery_fees: number;
  /** Open orders created or scheduled for the day: still to receive. */
  pending_orders: number;
  pending_total: number;
  /** Change the cashier must separate for pending cash orders. */
  change_needed: number;
}

/** Admin only. `date` is a store-local day ("YYYY-MM-DD"). */
export async function getCashClosing(date: string): Promise<{ ok: true; cash: CashClosing } | { ok: false; error: string }> {
  try {
    await requireAdmin();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Data inválida.");
    const day = (column: string) => `${local(column)}::date = $1::date`;

    const [received, [rest]] = await Promise.all([
      query<CashClosing["received"][number]>(
        `select payment_method as method, count(*) as orders, sum(total) as total
           from orders where status = 'completed' and ${day("completed_at")}
          group by 1 order by total desc`,
        [date],
      ),
      query<Omit<CashClosing, "date" | "received">>(
        `select
           coalesce(sum(delivery_fee) filter (where status = 'completed' and ${day("completed_at")}), 0) as delivery_fees,
           count(*) filter (where status in ('new', 'preparing', 'out_for_delivery')
                              and ${day("coalesce(scheduled_for, created_at)")}) as pending_orders,
           coalesce(sum(total) filter (where status in ('new', 'preparing', 'out_for_delivery')
                                         and ${day("coalesce(scheduled_for, created_at)")}), 0) as pending_total,
           coalesce(sum(change_for - total) filter (where status in ('new', 'preparing', 'out_for_delivery') and payment_method = 'cash'
                                                      and change_for is not null and ${day("coalesce(scheduled_for, created_at)")}), 0) as change_needed
         from orders`,
        [date],
      ),
    ]);
    return { ok: true, cash: { date, received, ...rest } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao carregar o caixa." };
  }
}
