"use client";

import { AlertTriangle, Cake, CalendarDays, ChevronRight, CircleDollarSign, MessageCircle, Receipt, TrendingUp } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { birthdayMessage } from "@/lib/customer";
import { cn, formatBRL, formatCompactBRL, whatsappLink } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { useMounted } from "@/lib/use-mounted";
import { getDashboard, type DashboardResult, type DayPoint, type Metrics, type TopProduct } from "@/actions/dashboard";
import { CashCard, CustomersCard, DataTable, Delta, HeatmapCard, NeighborhoodsCard, ProfitCard, TimesCard } from "./dashboard-sections";
import { PageHeader, useProfile } from "./panel-shell";

type Extra = Omit<Extract<DashboardResult, { ok: true }>, "ok" | "metrics" | "series" | "top">;

const RANGES = [7, 30, 90] as const;

// Chart colors come from the validated tokens; SVG attributes need concrete values.
// They follow the palette chosen in the panel (read from the page); these hexes are the fallback.
const CHART = {
  light: { mark: "#7d3a8b", grid: "#e8dce6", text: "#63555d", surface: "#ffffff" },
  dark: { mark: "#b072bc", grid: "#2e2a25", text: "#aaa194", surface: "#1b1916" },
};
const CHART_TOKENS = { mark: "--chart-1", grid: "--border", text: "--muted-foreground", surface: "--surface" } as const;

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
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  // narrower name axis in the "most sold" chart on phones
  const isPhone = useMediaQuery("(max-width: 639px)");
  const base = CHART[resolvedTheme === "dark" ? "dark" : "light"];
  // read on each render: a light/dark switch re-renders through resolvedTheme
  const colors = Object.fromEntries(
    Object.entries(CHART_TOKENS).map(([k, token]) => [k, (mounted && resolvedTheme && resolveToken(token)) || base[k as keyof typeof base]]),
  ) as typeof base;
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [series, setSeries] = useState<DayPoint[] | null>(null);
  const [top, setTop] = useState<TopProduct[] | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);

  // metrics are all-time/today/month; series and ranking follow the selected range
  useEffect(() => {
    let cancelled = false;
    getDashboard(range)
      .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Erro ao carregar." }))
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          toast.error(res.error);
          setSeries((v) => v ?? []);
          setTop((v) => v ?? []);
          return;
        }
        const { metrics: m, series: s, top: t, ...rest } = res;
        setMetrics(m);
        setSeries(s);
        setTop(t);
        setExtra(rest);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rangeRevenue = series?.reduce((n, d) => n + d.revenue, 0) ?? 0;
  const rangeOrders = series?.reduce((n, d) => n + d.orders, 0) ?? 0;
  const shortDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title="Dashboard" description="Vendas consideram todos os pedidos, exceto cancelados." />

      {metrics && metrics.low_stock > 0 && (
        <div className="px-4 sm:px-6">
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
        </div>
      )}

      {extra && extra.birthdays.length > 0 && (
        <div className="px-4 sm:px-6">
          <Card className="p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-bold">
              <Cake className="size-4 text-primary" />
              Aniversariantes
            </p>
            <ul className="divide-y divide-border text-sm">
              {extra.birthdays.map((c) => (
                <li key={c.phone} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{c.name}</strong> {c.days_left === 0 ? "está de aniversário hoje" : `faz aniversário ${c.days_left === 1 ? "amanhã" : `em ${c.days_left} dias`} (${c.birthday.slice(8, 10)}/${c.birthday.slice(5, 7)})`}
                  </span>
                  <a
                    href={whatsappLink(c.phone, birthdayMessage(extra.birthday_message, c.name, extra.store_name))}
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
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 sm:px-6 xl:grid-cols-4">
        <Kpi
          icon={CircleDollarSign}
          label="Vendas hoje"
          value={metrics && formatBRL(metrics.today_revenue)}
          hint={metrics && `${metrics.today_orders} pedidos`}
          delta={metrics && <Delta current={metrics.today_revenue} previous={metrics.yesterday_revenue} label="vs ontem até agora" />}
        />
        <Kpi
          icon={CalendarDays}
          label="Vendas no mês"
          value={metrics && formatBRL(metrics.month_revenue)}
          hint={metrics && `${metrics.month_orders} pedidos`}
          delta={metrics && <Delta current={metrics.month_revenue} previous={metrics.prev_month_revenue} label="vs mês passado" />}
        />
        <Kpi
          icon={TrendingUp}
          label={`Vendas em ${range} dias`}
          value={metrics && formatBRL(metrics.range_revenue)}
          hint={metrics && `${metrics.range_orders} pedidos`}
          delta={metrics && <Delta current={metrics.range_revenue} previous={metrics.prev_range_revenue} label={`vs ${range} dias anteriores`} />}
        />
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
      </div>

      {metrics && metrics.open_orders > 0 && (
        <div className="px-4 sm:px-6">
          <Link
            href="/admin/pedidos"
            className="flex items-center justify-between gap-3 rounded-lg bg-primary-soft px-4 py-3 text-sm font-semibold text-primary-soft-foreground hover:bg-primary-soft-hover"
          >
            <span>
              {metrics.open_orders} {metrics.open_orders === 1 ? "pedido em andamento" : "pedidos em andamento"}
            </span>
            <span>Abrir pedidos →</span>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 px-4 sm:px-6 xl:grid-cols-2">
        <CashCard />
        <ProfitCard profit={extra?.profit ?? null} range={range} />
      </div>

      <div className="flex items-center gap-2 px-4 sm:px-6" role="group" aria-label="Período dos gráficos">
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

      <div className="grid grid-cols-1 gap-4 px-4 sm:px-6 xl:grid-cols-[1.6fr_1fr]">
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
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 sm:px-6 xl:grid-cols-[1.6fr_1fr]">
        <HeatmapCard heat={extra?.heat ?? null} range={range} />
        <TimesCard times={extra?.times ?? null} range={range} />
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 sm:px-6 xl:grid-cols-2">
        <CustomersCard customers={extra?.customers ?? null} storeName={extra?.store_name ?? "loja"} range={range} />
        <NeighborhoodsCard neighborhoods={extra?.neighborhoods ?? null} range={range} />
      </div>
    </div>
  );
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
