// Panel pages that can be pinned to the phone bar and tablet rail. Pure, shared
// by the panel shell and the action that saves each person's choice.

import type { UserRole } from "@/types";

export const NAV_KEYS = ["dashboard", "pedidos", "encomendas", "cardapio", "estoque", "custos", "clientes", "cupons", "equipe", "loja", "treinamento", "conta"] as const;
export type NavKey = (typeof NAV_KEYS)[number];

/** Pages only the manager opens. */
export const ADMIN_ONLY: ReadonlySet<NavKey> = new Set(["dashboard", "custos", "clientes", "cupons", "equipe", "loja"]);

export const DEFAULT_PINS: NavKey[] = ["pedidos", "encomendas", "cardapio", "estoque"];
export const MAX_PINS = 4;

export const canSee = (key: NavKey, role: UserRole) => role === "admin" || !ADMIN_ONLY.has(key);

/** The pins to show: saved ones the role can still open, or the defaults when none is left. */
export function resolvePins(saved: readonly string[] | null | undefined, role: UserRole): NavKey[] {
  const pins = (saved ?? []).filter((k): k is NavKey => (NAV_KEYS as readonly string[]).includes(k) && canSee(k as NavKey, role));
  return pins.length ? pins.slice(0, MAX_PINS) : DEFAULT_PINS.filter((k) => canSee(k, role));
}

/** Why a choice can't be saved, or null when it can. */
export function pinsError(keys: readonly string[], role: UserRole): string | null {
  if (keys.length < 1) return "Escolha ao menos um atalho.";
  if (keys.length > MAX_PINS) return `Escolha no máximo ${MAX_PINS} atalhos.`;
  if (new Set(keys).size !== keys.length) return "Atalho repetido.";
  for (const k of keys) {
    if (!(NAV_KEYS as readonly string[]).includes(k)) return "Página desconhecida.";
    if (!canSee(k as NavKey, role)) return "Esta página é só do gerente.";
  }
  return null;
}
