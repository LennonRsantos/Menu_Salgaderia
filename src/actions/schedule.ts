"use server";

import { requireStaff } from "@/lib/auth";
import { query } from "@/lib/db";
import { ORDER_COLUMNS, orderFromRow } from "@/lib/orders";
import type { Order } from "@/types";

/** viewDays: the range set in Configurações (schedule_view_days). */
export type ScheduleResult = { ok: true; orders: Order[]; viewDays: number } | { ok: false; error: string };

/**
 * Scheduled orders from today (São Paulo time) up to `days` ahead, cancelled ones left out.
 * `days` null = the range set in Configurações.
 */
export async function fetchSchedule(days: number | null): Promise<ScheduleResult> {
  try {
    await requireStaff();
    const [settings] = await query<{ schedule_view_days: number }>("select schedule_view_days from store_settings where id = 1");
    const viewDays = Number(settings?.schedule_view_days ?? 60);
    const range = Math.min(Math.max(Math.floor(days ?? viewDays) || 7, 1), 180);
    const rows = await query(
      `select ${ORDER_COLUMNS} from orders
        where scheduled_for is not null and status <> 'cancelled'
          and scheduled_for >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
          and scheduled_for < (date_trunc('day', now() at time zone 'America/Sao_Paulo') + ($1::int + 1) * interval '1 day') at time zone 'America/Sao_Paulo'
        order by scheduled_for, code`,
      [range],
    );
    return { ok: true, orders: rows.map(orderFromRow), viewDays };
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
