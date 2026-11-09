"use client";

import { CalendarClock, ChefHat, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updateOrderStatus } from "@/actions/orders";
import { fetchSchedule } from "@/actions/schedule";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { cn, formatBRL } from "@/lib/format";
import { spNow, TIME_ZONE } from "@/lib/hours";
import { STATUS_TONE, statusLabel } from "@/lib/order-status";
import type { Order, OrderStatus } from "@/types";
import { OrderDetailSheet } from "./order-detail-sheet";
import { PageHeader } from "./panel-shell";

const dayTitle = (date: string, today: string, tomorrow: string) => {
  const label = new Date(`${date}T12:00:00-03:00`).toLocaleDateString("pt-BR", { timeZone: TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit" });
  const nice = label.charAt(0).toUpperCase() + label.slice(1);
  return date === today ? `Hoje · ${label}` : date === tomorrow ? `Amanhã · ${label}` : nice;
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** Quantity per product + chosen options, so the kitchen sees what to make that day. */
function productionList(orders: Order[]) {
  const totals = new Map<string, { name: string; options: string; quantity: number }>();
  for (const o of orders) {
    for (const i of o.order_items) {
      const options = i.addons.map((a) => a.name).sort().join(", ");
      const key = `${i.product_name}|${options}`;
      const entry = totals.get(key) ?? { name: i.product_name, options, quantity: 0 };
      entry.quantity += i.quantity;
      totals.set(key, entry);
    }
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}

export function ScheduleView() {
  // "config" = the range set in Configurações (viewDays)
  const [range, setRange] = useState<"week" | "config">("config");
  const [viewDays, setViewDays] = useState(60);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSchedule(range === "week" ? 7 : null).catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    if (!result.ok) {
      toast.error(result.error);
      setOrders((o) => o ?? []);
      return;
    }
    setOrders(result.orders);
    setViewDays(result.viewDays);
  }, [range]);

  const ranges = [
    { id: "week" as const, days: 7 },
    { id: "config" as const, days: viewDays },
  ].filter((r) => r.id === "week" || r.days !== 7);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on range change
    load();
  }, [load]);

  const days = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of orders ?? []) {
      const date = spNow(new Date(o.scheduled_for!)).date;
      map.set(date, [...(map.get(date) ?? []), o]);
    }
    return [...map.entries()];
  }, [orders]);

  const [[today, tomorrow]] = useState(() => {
    const now = Date.now();
    return [spNow(new Date(now)).date, spNow(new Date(now + 86_400_000)).date];
  });

  async function changeStatus(order: Order, to: OrderStatus) {
    const result = await updateOrderStatus(order.id, to).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Sem conexão." }));
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`#${order.code}: ${statusLabel(to, order.fulfillment)}`);
    setSelected(null);
    await load();
    return true;
  }

  return (
    <div className="pb-8">
      <PageHeader
        title="Encomendas"
        description="Pedidos agendados e o que produzir em cada dia."
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
        }
      />
      <div className="flex gap-2 px-4 pb-4 sm:px-6">
        {ranges.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            aria-pressed={range === r.id}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors",
              range === r.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            Próximos {r.days} dias
          </button>
        ))}
      </div>

      <div className="space-y-6 px-4 sm:px-6">
        {!orders ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)
        ) : days.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhuma encomenda agendada"
            description="Ative as encomendas em Loja para os clientes agendarem pedidos com data."
          />
        ) : (
          days.map(([date, list]) => (
            <section key={date} aria-labelledby={`day-${date}`} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr]">
              <div className="lg:col-span-2 flex flex-wrap items-baseline gap-x-3">
                <h2 id={`day-${date}`} className="text-lg font-bold">
                  {dayTitle(date, today, tomorrow)}
                </h2>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {list.length} {list.length === 1 ? "encomenda" : "encomendas"} · {formatBRL(list.reduce((n, o) => n + o.total, 0))}
                </span>
              </div>
              <Card className="p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <ChefHat className="size-4" />
                  Produção do dia
                </h3>
                <ul className="divide-y divide-border text-sm">
                  {productionList(list).map((p) => (
                    <li key={`${p.name}|${p.options}`} className="flex items-baseline gap-3 py-2">
                      <span className="w-10 shrink-0 text-right text-base font-bold tabular-nums">{p.quantity}×</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{p.name}</span>
                        {p.options && <span className="block text-xs text-muted-foreground">{p.options}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="divide-y divide-border overflow-hidden">
                {list.map((o) => (
                  <button key={o.id} type="button" onClick={() => setSelected(o)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <span className="w-12 shrink-0 font-bold tabular-nums">{timeOf(o.scheduled_for!)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        #{o.code} · {o.customer_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.fulfillment === "pickup" ? "Retirada" : `Entrega · ${o.address?.neighborhood ?? ""}`} · {o.order_items.reduce((n, i) => n + i.quantity, 0)} itens
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-bold tabular-nums">{formatBRL(o.total)}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[o.status])}>{statusLabel(o.status, o.fulfillment)}</span>
                    </span>
                  </button>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>

      <OrderDetailSheet key={selected?.id} order={selected} onClose={() => setSelected(null)} onChangeStatus={changeStatus} />
    </div>
  );
}
