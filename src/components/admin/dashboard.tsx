"use client";

import { AlertTriangle, Cake, CalendarDays, ChevronRight, CircleDollarSign, MessageCircle, Receipt, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { birthdayMessage } from "@/lib/customer";
import { partsOf, RANGES, resolveLayout, WIDGET, type Range, type WidgetKey } from "@/lib/dashboard-layout";
import { cn, formatBRL, formatCompactBRL, whatsappLink } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { useMounted } from "@/lib/use-mounted";
import { getDashboard, saveDashboardLayout, type DashboardData } from "@/actions/dashboard";
import type { DashboardLayout } from "@/types";
import { DashboardCustomizer } from "./dashboard-customize";
import { CashCard, CustomersCard, DataTable, Delta, HeatmapCard, NeighborhoodsCard, ProfitCard, TimesCard } from "./dashboard-sections";
import { PageHeader, useProfile, useSetProfile } from "./panel-shell";

// Chart colors come from the validated tokens; SVG attributes need concrete values.
// They follow the palette chosen in the panel (read from the page); these hexes are the fallback.
const CHART = {
  light: { mark: "#7d3a8b", grid: "#e8dce6", text: "#63555d", surface: "#ffffff" },
  dark: { mark: "#b072bc", grid: "#2e2a25", text: "#aaa194", surface: "#1b1916" },
};
const CHART_TOKENS = { mark: "--chart-1", grid: "--border", text: "--muted-foreground", surface: "--surface" } as const;

const NO_DATA: DashboardData = {
  metrics: null,
  series: null,
  top: null,
  profit: null,
  heat: null,
  times: null,
  customers: null,
  neighborhoods: null,
  store_name: null,
  birthdays: null,
  birthday_message: null,
};

/** A color token as "rgb(r g b)": tokens may be color-mix(), which SVG attributes don't take everywhere. */
function resolveToken(name: string) {
  const ctx = document.createElement("canvas").getContext("2d");
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!ctx || !value) return "";
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
}

export function Dashboard() {
  const profile = useProfile();
  const router = useRouter();
  const isAdmin = profile.role === "admin";

  useEffect(() => {
    if (!isAdmin) router.replace("/admin/pedidos");
  }, [isAdmin, router]);

  if (!isAdmin) return null;
  return <DashboardContent />;
}

function DashboardContent() {
  const profile = useProfile();
  const setProfile = useSetProfile();
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  // narrower name axis in the "most sold" chart on phones
  const isPhone = useMediaQuery("(max-width: 639px)");
  const base = CHART[resolvedTheme === "dark" ? "dark" : "light"];
  // read on each render: a light/dark switch re-renders through resolvedTheme
  const colors = Object.fromEntries(
    Object.entries(CHART_TOKENS).map(([k, token]) => [k, (mounted && resolvedTheme && resolveToken(token)) || base[k as keyof typeof base]]),
  ) as typeof base;
  // each manager's own blocks, order, widths and opening period
  const layout = resolveLayout(profile.dashboard_layout);
  const [range, setRange] = useState<Range>(layout.range);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<DashboardData>(NO_DATA);
  // only the data of the visible blocks is loaded; a string, so reordering doesn't reload
  const partsKey = partsOf(layout.items).join(",");

  // metrics are all-time/today/month; series and ranking follow the selected range
  useEffect(() => {
    if (!partsKey) return;
    let cancelled = false;
    getDashboard(range, partsKey.split(","))
      .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Erro ao carregar." }))
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          toast.error(res.error);
          setData((d) => ({ ...d, series: d.series ?? [], top: d.top ?? [] }));
          return;
        }
        setData(res.data);
      });
    return () => {
      cancelled = true;
    };
  }, [range, partsKey]);

  // the Dashboard changes at once; a failed save puts the previous layout back
  async function saveLayout(next: DashboardLayout | null) {
    const previous = profile.dashboard_layout;
    setProfile({ ...profile, dashboard_layout: next });
    const result = await saveDashboardLayout(next).catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    if (!result.ok) {
      setProfile({ ...profile, dashboard_layout: previous });
      toast.error(result.error);
      return false;
    }
    // a new opening period shows right away; otherwise the period on screen stays
    const nextRange = resolveLayout(next).range;
    if (nextRange !== resolveLayout(previous).range) setRange(nextRange);
    toast.success("Dashboard salvo.");
    return true;
  }

  const { metrics, series, top } = data;
  const rangeRevenue = series?.reduce((n, d) => n + d.revenue, 0) ?? 0;
  const rangeOrders = series?.reduce((n, d) => n + d.orders, 0) ?? 0;
  const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  function salesChart() {
    return (
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold">Vendas por dia</h2>
            <p className="text-sm text-muted-foreground">Últimos {range} dias</p>
          </div>
          <p className="text-right">
            <span className="block text-xl font-bold tabular-nums">{formatBRL(rangeRevenue)}</span>
            <span className="text-xs text-muted-foreground">{rangeOrders} pedidos no período</span>
          </p>
        </div>
        {!series ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="h-64" role="img" aria-label={`Gráfico de vendas por dia nos últimos ${range} dias, total ${formatBRL(rangeRevenue)}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={shortDay}
                    tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCompactBRL(v).replace(",00", "")}
                    tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: colors.text, strokeWidth: 1 }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <ChartTooltip
                          title={new Date(`${payload[0].payload.day}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                          lines={[formatBRL(payload[0].payload.revenue), `${payload[0].payload.orders} pedidos`]}
                        />
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={colors.mark}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    fill={colors.mark}
                    fillOpacity={0.1}
                    activeDot={{ r: 5, fill: colors.mark, stroke: colors.surface, strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <DataTable
              headers={["Dia", "Pedidos", "Vendas"]}
              rows={series
                .filter((d) => d.orders > 0)
                .reverse()
                .map((d) => [shortDay(d.day), String(d.orders), formatBRL(d.revenue)])}
            />
          </>
        )}
      </Card>
    );
  }

  function topItems() {
    return (
      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-bold">Itens mais vendidos</h2>
          <p className="text-sm text-muted-foreground">Quantidade nos últimos {range} dias</p>
        </div>
        {!top ? (
          <Skeleton className="h-64" />
        ) : top.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Sem vendas no período" className="py-10" />
        ) : (
          <>
            <div style={{ height: Math.max(160, top.length * 44) }} role="img" aria-label="Ranking dos itens mais vendidos por quantidade">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }} barCategoryGap={10}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="product_name"
                    width={isPhone ? 96 : 130}
                    tick={{ fill: colors.text, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => {
                      const max = isPhone ? 13 : 18;
                      return v.length > max ? `${v.slice(0, max - 1)}…` : v;
                    }}
                  />
                  <Tooltip
                    cursor={{ fill: colors.grid, fillOpacity: 0.4 }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <ChartTooltip
                          title={payload[0].payload.product_name}
                          lines={[`${payload[0].payload.quantity} unidades`, formatBRL(payload[0].payload.revenue)]}
                        />
                      ) : null
                    }
                  />
                  <Bar dataKey="quantity" fill={colors.mark} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
                    <LabelList dataKey="quantity" position="right" fill={colors.text} fontSize={12} fontWeight={600} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DataTable headers={["Item", "Qtd.", "Vendas"]} rows={top.map((p) => [p.product_name, String(p.quantity), formatBRL(p.revenue)])} />
          </>
        )}
      </Card>
    );
  }

  /** One block; null when it has nothing to show (alerts with nothing to warn about). */
  function block(key: WidgetKey): ReactNode {
    switch (key) {
      case "low_stock":
        return metrics && metrics.low_stock > 0 ? (
          <Link
            href="/admin/estoque"
            className="flex items-center gap-3 rounded-lg border border-warning-soft-foreground/30 bg-warning-soft px-4 py-3 text-warning-soft-foreground transition-colors hover:brightness-95 dark:hover:brightness-125"
          >
            <AlertTriangle className="size-5 shrink-0" />
            <span className="flex-1 text-sm">
              <strong>
                {metrics.low_stock} {metrics.low_stock === 1 ? "item com estoque baixo" : "itens com estoque baixo"}
              </strong>
              {metrics.out_of_stock > 0 && ` · ${metrics.out_of_stock} ${metrics.out_of_stock === 1 ? "esgotado" : "esgotados"}`}
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold">
              Ver estoque
              <ChevronRight className="size-4" />
            </span>
          </Link>
        ) : null;
      case "birthdays":
        return data.birthdays && data.birthdays.length > 0 ? (
          <Card className="p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-bold">
              <Cake className="size-4 text-primary" />
              Aniversariantes
            </p>
            <ul className="divide-y divide-border text-sm">
              {data.birthdays.map((c) => (
                <li key={c.phone} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{c.name}</strong> {c.days_left === 0 ? "está de aniversário hoje" : `faz aniversário ${c.days_left === 1 ? "amanhã" : `em ${c.days_left} dias`} (${c.birthday.slice(8, 10)}/${c.birthday.slice(5, 7)})`}
                  </span>
                  <a
                    href={whatsappLink(c.phone, birthdayMessage(data.birthday_message, c.name, data.store_name ?? "loja"))}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses("soft", "sm", "shrink-0")}
                    aria-label={`Enviar parabéns para ${c.name} no WhatsApp`}
                  >
                    <MessageCircle className="size-4" />
                    Enviar parabéns
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        ) : null;
      case "kpi_today":
        return (
          <Kpi
            icon={CircleDollarSign}
            label="Vendas hoje"
            value={metrics && formatBRL(metrics.today_revenue)}
            hint={metrics && `${metrics.today_orders} pedidos`}
            delta={metrics && <Delta current={metrics.today_revenue} previous={metrics.yesterday_revenue} label="vs ontem até agora" />}
          />
        );
      case "kpi_month":
        return (
          <Kpi
            icon={CalendarDays}
            label="Vendas no mês"
            value={metrics && formatBRL(metrics.month_revenue)}
            hint={metrics && `${metrics.month_orders} pedidos`}
            delta={metrics && <Delta current={metrics.month_revenue} previous={metrics.prev_month_revenue} label="vs mês passado" />}
          />
        );
      case "kpi_range":
        return (
          <Kpi
            icon={TrendingUp}
            label={`Vendas em ${range} dias`}
            value={metrics && formatBRL(metrics.range_revenue)}
            hint={metrics && `${metrics.range_orders} pedidos`}
            delta={metrics && <Delta current={metrics.range_revenue} previous={metrics.prev_range_revenue} label={`vs ${range} dias anteriores`} />}
          />
        );
      case "kpi_ticket":
        return (
          <Kpi
            icon={Receipt}
            label="Ticket médio"
            value={metrics && formatBRL(ticket(metrics.range_revenue, metrics.range_orders))}
            hint={`por pedido em ${range} dias`}
            delta={
              metrics && (
                <Delta
                  current={ticket(metrics.range_revenue, metrics.range_orders)}
                  previous={ticket(metrics.prev_range_revenue, metrics.prev_range_orders)}
                  label="vs período anterior"
                />
              )
            }
          />
        );
      case "open_orders":
        return metrics && metrics.open_orders > 0 ? (
          <Link
            href="/admin/pedidos"
            className="flex items-center justify-between gap-3 rounded-lg bg-primary-soft px-4 py-3 text-sm font-semibold text-primary-soft-foreground hover:bg-primary-soft-hover"
          >
            <span>
              {metrics.open_orders} {metrics.open_orders === 1 ? "pedido em andamento" : "pedidos em andamento"}
            </span>
            <span>Abrir pedidos →</span>
          </Link>
        ) : null;
      case "cash":
        return <CashCard />;
      case "profit":
        return <ProfitCard profit={data.profit} range={range} />;
      case "sales_chart":
        return salesChart();
      case "top_items":
        return topItems();
      case "heatmap":
        return <HeatmapCard heat={data.heat} range={range} />;
      case "times":
        return <TimesCard times={data.times} range={range} />;
      case "customers":
        return <CustomersCard customers={data.customers} storeName={data.store_name ?? "loja"} range={range} />;
      case "neighborhoods":
        return <NeighborhoodsCard neighborhoods={data.neighborhoods} range={range} />;
    }
  }

  const cells = layout.items.flatMap((it) => {
    const node = it.hidden ? null : block(it.key);
    // stretched to the row, so blocks side by side match in height
    return node ? [<div key={it.key} className={cn("min-w-0 *:h-full", span(it.key, it.full))}>{node}</div>] : [];
  });

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Dashboard"
        description="Vendas consideram todos os pedidos, exceto cancelados."
        actions={
          <>
            <div className="flex items-center gap-2" role="group" aria-label="Período dos gráficos">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={cn(
                    "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                    range === r ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong bg-surface text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r} dias
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setEditing(true)} className={buttonClasses("outline", "sm", "h-9")}>
              <SlidersHorizontal className="size-4" />
              Personalizar
            </button>
          </>
        }
      />

      {layout.items.some((it) => !it.hidden) ? (
        <div className="grid grid-cols-2 gap-3 px-4 sm:gap-4 sm:px-6 xl:grid-cols-4">{cells}</div>
      ) : (
        <EmptyState
          icon={SlidersHorizontal}
          title="Nenhum bloco no seu dashboard"
          description="Escolha o que você quer ver aqui."
          action={
            <button type="button" onClick={() => setEditing(true)} className={buttonClasses("primary")}>
              Personalizar
            </button>
          }
          className="py-16"
        />
      )}

      {editing && <DashboardCustomizer layout={layout} onClose={() => setEditing(false)} onSave={saveLayout} />}
    </div>
  );
}

/** Columns a block takes: two per row on phones and tablets, four on computers. */
function span(key: WidgetKey, full: boolean) {
  const { kind } = WIDGET[key];
  if (kind === "tile") return "col-span-1";
  if (kind === "alert" || full) return "col-span-2 xl:col-span-4";
  return "col-span-2";
}

const ticket = (revenue: number, orders: number) => (orders > 0 ? revenue / orders : 0);

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  delta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  hint?: string | null;
  delta?: React.ReactNode;
}) {
  return (
    // two per row on phones, so it stays compact there
    <Card className="min-w-0 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-foreground sm:size-8">
          <Icon className="size-4" />
        </span>
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-full max-w-32" />
      ) : (
        <p className="mt-1.5 text-xl font-bold tracking-tight whitespace-nowrap tabular-nums sm:mt-2 sm:text-2xl">{value}</p>
      )}
      <p className="mt-0.5 text-xs text-muted-foreground">{hint ?? " "}</p>
      {delta && <div className="mt-2">{delta}</div>}
    </Card>
  );
}

function ChartTooltip({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-md">
      <p className="font-semibold">{title}</p>
      {lines.map((l) => (
        <p key={l} className="text-muted-foreground tabular-nums">
          {l}
        </p>
      ))}
    </div>
  );
}
