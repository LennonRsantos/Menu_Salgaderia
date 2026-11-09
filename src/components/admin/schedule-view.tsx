"use client";

import { CalendarClock, ChefHat, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { updateOrderStatus } from "@/actions/orders";
import { fetchSchedule } from "@/actions/schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { cn, formatBRL } from "@/lib/format";
import { spNow, TIME_ZONE } from "@/lib/hours";
import { ACTIVE_STATUSES, STATUS_TONE, statusLabel } from "@/lib/order-status";
import { upcomingSpecialDates } from "@/lib/special-dates";
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

const isPending = (o: Order) => ACTIVE_STATUSES.includes(o.status);
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

type Preset = { from: string; to: string; label: string };

/** Date shortcuts: Natal, Ano Novo, then the next holidays and store dates. */
function presets(today: string, storeDates: { date: string; title: string }[]): Preset[] {
  const year = Number(today.slice(0, 4));
  const christmas = today > `${year}-12-25` ? year + 1 : year;
  // on 1 January the current New Year is still on
  const newYear = today.slice(5) === "01-01" ? year - 1 : year;
  const covered = ["12-24", "12-25", "12-31", "01-01"];
  return [
    { from: `${christmas}-12-24`, to: `${christmas}-12-25`, label: "Natal" },
    { from: `${newYear}-12-31`, to: `${newYear + 1}-01-01`, label: "Ano Novo" },
    ...upcomingSpecialDates(today, storeDates, 180)
      .filter((d) => !covered.includes(d.date.slice(5)))
      .slice(0, 4)
      .map((d) => ({ from: d.date, to: d.date, label: `${d.title} · ${dayMonth(d.date)}` })),
  ];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors",
        active ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ScheduleView() {
  // "config" = the range set in Configurações (viewDays); "custom" = the days typed in
  const [range, setRange] = useState<"week" | "config" | "custom" | Preset>("config");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [viewDays, setViewDays] = useState(60);
  const [storeDates, setStoreDates] = useState<{ date: string; title: string }[]>([]);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  // a slow answer for a filter left behind doesn't overwrite the current one
  const request = useRef(0);
  const customReady = Boolean(custom.from && custom.to);

  const load = useCallback(async () => {
    if (range === "custom" && !customReady) return;
    const id = ++request.current;
    const filter = range === "week" ? 7 : range === "config" ? null : range === "custom" ? { from: custom.from, to: custom.to } : { from: range.from, to: range.to };
    const result = await fetchSchedule(filter).catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    if (id !== request.current) return;
    if (!result.ok) {
      toast.error(result.error);
      setOrders((o) => o ?? []);
      return;
    }
    setOrders(result.orders);
    setViewDays(result.viewDays);
    setStoreDates(result.specialDates);
  }, [range, custom.from, custom.to, customReady]);

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
  const pending = (orders ?? []).filter(isPending);

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
      <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-6" role="group" aria-label="Período das encomendas">
        {ranges.map((r) => (
          <Chip key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>
            Próximos {r.days} dias
          </Chip>
        ))}
        {presets(today, storeDates).map((p) => (
          <Chip key={p.label} active={typeof range === "object" && range.label === p.label} onClick={() => setRange(p)}>
            {p.label}
          </Chip>
        ))}
        <Chip active={range === "custom"} onClick={() => setRange("custom")}>
          Escolher datas
        </Chip>
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-end gap-3 px-4 pb-4 sm:px-6">
          <label className="grid gap-1 text-sm font-semibold">
            De
            <Input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 w-44" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Até
            <Input type="date" min={custom.from || undefined} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 w-44" />
          </label>
        </div>
      )}

      <div className="space-y-6 px-4 sm:px-6">
        {range === "custom" && !customReady ? (
          <EmptyState icon={CalendarClock} title="Escolha as datas" description="Informe o primeiro e o último dia para ver as encomendas." />
        ) : !orders ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56" />)
        ) : days.length === 0 ? (
          range === "week" || range === "config" ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhuma encomenda agendada"
              description="Ative as encomendas em Loja para os clientes agendarem pedidos com data."
            />
          ) : (
            <EmptyState icon={CalendarClock} title="Nenhuma encomenda nessas datas" />
          )
        ) : (
          <>
          <Card className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
            <span className="text-2xl font-bold tabular-nums">{pending.length}</span>
            <span className="font-semibold">{pending.length === 1 ? "encomenda pendente" : "encomendas pendentes"}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              de {orders.length} no período · {formatBRL(pending.reduce((n, o) => n + o.total, 0))} em pendentes
            </span>
          </Card>
          {days.map(([date, list]) => (
            <section key={date} aria-labelledby={`day-${date}`} className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr]">
              <div className="lg:col-span-2 flex flex-wrap items-baseline gap-x-3">
                <h2 id={`day-${date}`} className="text-lg font-bold">
                  {dayTitle(date, today, tomorrow)}
                </h2>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {list.length} {list.length === 1 ? "encomenda" : "encomendas"} · {list.filter(isPending).length}{" "}
                  {list.filter(isPending).length === 1 ? "pendente" : "pendentes"} · {formatBRL(list.reduce((n, o) => n + o.total, 0))}
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
          ))}
          </>
        )}
      </div>

      <OrderDetailSheet key={selected?.id} order={selected} onClose={() => setSelected(null)} onChangeStatus={changeStatus} />
    </div>
  );
}
