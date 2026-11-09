"use server";

import { requireStaff } from "@/lib/auth";
import { query } from "@/lib/db";
import { SPECIAL_DATES_SQL } from "@/lib/menu";
import { ORDER_COLUMNS, orderFromRow } from "@/lib/orders";
import type { Order, StoreSettings } from "@/types";

/**
 * viewDays: the range set in Configurações (schedule_view_days).
 * specialDates: the store's own dates, for the date shortcuts.
 */
export type ScheduleResult =
  | { ok: true; orders: Order[]; viewDays: number; specialDates: StoreSettings["special_dates"] }
  | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Scheduled orders, cancelled ones left out. A number: from today (São Paulo
 * time) up to that many days ahead; null = the range set in Configurações.
 * `{ from, to }`: those days ("YYYY-MM-DD", both included).
 */
export async function fetchSchedule(range: number | null | { from: string; to: string }): Promise<ScheduleResult> {
  try {
    await requireStaff();
    let bounds: { text: string; params: unknown[] } | null = null;
    if (range && typeof range === "object") {
      const { from, to } = range;
      const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (!DAY.test(from) || !DAY.test(to) || !(span >= 0 && span <= 366)) return { ok: false, error: "Período inválido." };
      bounds = {
        text: `scheduled_for >= $1::date::timestamp at time zone 'America/Sao_Paulo'
          and scheduled_for < ($2::date + 1)::timestamp at time zone 'America/Sao_Paulo'`,
        params: [from, to],
      };
    }
    const [[settings], specialDates] = await Promise.all([
      query<{ schedule_view_days: number }>("select schedule_view_days from store_settings where id = 1"),
      query<StoreSettings["special_dates"][number]>(SPECIAL_DATES_SQL),
    ]);
    const viewDays = Number(settings?.schedule_view_days ?? 60);
    bounds ??= {
      text: `scheduled_for >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
          and scheduled_for < (date_trunc('day', now() at time zone 'America/Sao_Paulo') + ($1::int + 1) * interval '1 day') at time zone 'America/Sao_Paulo'`,
      params: [Math.min(Math.max(Math.floor((range as number | null) ?? viewDays) || 7, 1), 180)],
    };
    const rows = await query(
      `select ${ORDER_COLUMNS} from orders
        where scheduled_for is not null and status <> 'cancelled'
          and ${bounds.text}
        order by scheduled_for, code`,
      bounds.params,
    );
    return { ok: true, orders: rows.map(orderFromRow), viewDays, specialDates };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao carregar as encomendas." };
  }
}

/**
 * Public: scheduling slots that reached the store's per-slot limit, as
 * "YYYY-MM-DD HH:MM" (São Paulo time). Only keys, never order data.
 */
export async function getFullSlots(): Promise<string[]> {
  try {
    const rows = await query<{ k: string }>(
      `select to_char(o.scheduled_for at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as k
         from orders o, store_settings s
        where s.id = 1 and s.slot_capacity is not null
          and o.scheduled_for >= now() and o.status <> 'cancelled'
        group by 1, s.slot_capacity
       having count(*) >= s.slot_capacity`,
    );
    return rows.map((r) => r.k);
  } catch {
    return [];
  }
}
