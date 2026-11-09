// Dashboard blocks each manager shows, hides, orders and widens. Pure, shared by
// the Dashboard, its "Personalizar" sheet and the action that saves the choice.

import type { DashboardLayout } from "@/types";

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = 30;

/** Data groups getDashboard can load; each block names the one it shows. */
export const PARTS = ["metrics", "birthdays", "series", "top", "profit", "heat", "times", "customers", "neighborhoods"] as const;
export type Part = (typeof PARTS)[number];

// alert: the whole row, only when there is something to warn about
// tile: a quarter of the row on computers
// card: half the row on computers, or the whole row when the manager picks it
type Widget = { label: string; hint: string; kind: "alert" | "tile" | "card"; part?: Part };
// keeps the literal keys while typing every block as a Widget
const widgets = <K extends string>(w: Record<K, Widget>) => w;

/** Every block, in the default order. "cash" loads its own data. */
export const WIDGET = widgets({
  low_stock: { label: "Estoque baixo", hint: "Alerta quando há itens no mínimo ou esgotados.", kind: "alert", part: "metrics" },
  birthdays: { label: "Aniversariantes", hint: "Alerta com quem faz aniversário, para mandar parabéns.", kind: "alert", part: "birthdays" },
  kpi_today: { label: "Vendas hoje", hint: "Comparadas a ontem até a mesma hora.", kind: "tile", part: "metrics" },
  kpi_month: { label: "Vendas no mês", hint: "Comparadas ao mês passado.", kind: "tile", part: "metrics" },
  kpi_range: { label: "Vendas no período", hint: "Nos últimos 7, 30 ou 90 dias.", kind: "tile", part: "metrics" },
  kpi_ticket: { label: "Ticket médio", hint: "Valor médio por pedido no período.", kind: "tile", part: "metrics" },
  open_orders: { label: "Pedidos em andamento", hint: "Alerta com os pedidos ainda abertos.", kind: "alert", part: "metrics" },
  scheduled: { label: "Encomendas pendentes", hint: "Alerta com as encomendas agendadas ainda não concluídas.", kind: "alert", part: "metrics" },
  cash: { label: "Fechamento de caixa", hint: "Recebido por forma de pagamento, dia a dia.", kind: "card" },
  profit: { label: "Lucro", hint: "Vendas menos custos e despesas, e margem por produto.", kind: "card", part: "profit" },
  sales_chart: { label: "Vendas por dia", hint: "Gráfico do faturamento no período.", kind: "card", part: "series" },
  top_items: { label: "Itens mais vendidos", hint: "Ranking por quantidade no período.", kind: "card", part: "top" },
  heatmap: { label: "Horários de pico", hint: "Pedidos por dia da semana e hora.", kind: "card", part: "heat" },
  times: { label: "Tempo de atendimento", hint: "Médias para aceitar, preparar e entregar.", kind: "card", part: "times" },
  customers: { label: "Clientes", hint: "Novos, quem mais comprou e clientes sumidos.", kind: "card", part: "customers" },
  neighborhoods: { label: "Entregas por bairro", hint: "Pedidos e vendas de cada bairro.", kind: "card", part: "neighborhoods" },
});
export type WidgetKey = keyof typeof WIDGET;
export const WIDGET_KEYS = Object.keys(WIDGET) as WidgetKey[];

export interface LayoutItem {
  key: WidgetKey;
  hidden: boolean;
  /** Card on the whole row instead of half (computers only). */
  full: boolean;
}
export interface ResolvedLayout {
  items: LayoutItem[];
  range: Range;
}

const isKey = (k: unknown): k is WidgetKey => (WIDGET_KEYS as unknown[]).includes(k);
const isRange = (n: unknown): n is Range => (RANGES as readonly unknown[]).includes(n);

/** The layout to show: the saved order and choices, without unknown or repeated blocks; blocks created since go at the end. */
export function resolveLayout(saved: DashboardLayout | null | undefined): ResolvedLayout {
  const items: LayoutItem[] = [];
  const raw = saved?.items;
  for (const it of Array.isArray(raw) ? raw : []) {
    const key = it?.key;
    if (!isKey(key) || items.some((i) => i.key === key)) continue;
    items.push({ key, hidden: it.hidden === true, full: it.full === true && WIDGET[key].kind === "card" });
  }
  for (const key of WIDGET_KEYS) if (!items.some((i) => i.key === key)) items.push({ key, hidden: false, full: false });
  const range = saved?.range;
  return { items, range: isRange(range) ? range : DEFAULT_RANGE };
}

/** Why a layout can't be saved, or null when it can. */
export function layoutError(layout: DashboardLayout): string | null {
  const items = Array.isArray(layout?.items) ? layout.items : null;
  if (!items || items.length > WIDGET_KEYS.length) return "Layout inválido.";
  const keys = items.map((i) => i?.key);
  if (!keys.every(isKey)) return "Bloco desconhecido.";
  if (new Set(keys).size !== keys.length) return "Bloco repetido.";
  if (items.every((i) => i.hidden === true)) return "Deixe ao menos um bloco visível.";
  if (layout.range !== undefined && !isRange(layout.range)) return "Período inválido.";
  return null;
}

/** Data groups the visible blocks need, in PARTS order. */
export function partsOf(items: readonly LayoutItem[]): Part[] {
  const needed = new Set(items.filter((i) => !i.hidden).map((i) => WIDGET[i.key].part));
  return PARTS.filter((p) => needed.has(p));
}
