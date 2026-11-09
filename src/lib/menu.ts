import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { Category, DeliveryZone, MenuCategory, Product, StockLink, StoreSettings } from "@/types";
import { isDatabaseConfigured, query } from "./db";
import { cleanHours, spNow } from "./hours";
import { applyStock } from "./stock";
import { activeTheme, DEFAULT_THEME, toFestiveMode, toPalette, type ActiveTheme } from "./themes";

export const MENU_TAG = "menu";
export const SETTINGS_TAG = "settings";

export type MenuResult = { ok: true; categories: MenuCategory[] } | { ok: false; error: string };

const bySort = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export const PRODUCT_COLUMNS =
  "id, category_id, name, description, price, image_url, is_visible, is_available, position, addon_groups";

/** Normalizes a products row (addon groups stored as jsonb) into plain data. */
export function productFromRow(r: Record<string, unknown>): Product {
  return {
    id: String(r.id),
    category_id: String(r.category_id ?? ""),
    name: String(r.name ?? ""),
    description: (r.description as string | null) ?? null,
    price: Number(r.price ?? 0),
    image_url: (r.image_url as string | null) ?? null,
    is_visible: r.is_visible !== false,
    is_available: r.is_available !== false,
    position: Number(r.position ?? 0),
    addon_groups: ((r.addon_groups ?? []) as Product["addon_groups"])
      .map((g, gi) => ({
        id: String(g.id),
        name: g.name ?? "",
        min_select: Number(g.min_select ?? 0),
        max_select: Number(g.max_select ?? 1),
        position: Number(g.position ?? gi),
        addons: (g.addons ?? [])
          .map((a, ai) => ({
            id: String(a.id),
            name: a.name ?? "",
            price: Number(a.price ?? 0),
            is_available: a.is_available !== false,
            position: Number(a.position ?? ai),
          }))
          .sort(bySort),
      }))
      .sort(bySort),
  };
}

export const SETTINGS_COLUMNS =
  "id, name, tagline, phone, logo_url, delivery_fee, min_order, is_open, opening_hours, auto_hours, hours, other_zones, schedule_enabled, schedule_min_hours, schedule_max_days, " +
  "address, delivery_enabled, pickup_enabled, delivery_min, delivery_max, pickup_min, pickup_max, slot_capacity, " +
  "theme_palette, festive_mode, festive_message, festive_effects, header_image_url, address_zip, " +
  "birthday_alert, birthday_days_before, birthday_message, schedule_view_days";
export const ZONES_SQL = "select id, name, fee, position from delivery_zones order by position, name";
export const SPECIAL_DATES_SQL = "select to_char(date, 'YYYY-MM-DD') as date, title from special_dates order by date";

/** Settings row + delivery zones, with hours cleaned up. */
export function settingsFromRow(
  row: Record<string, unknown>,
  zones: DeliveryZone[],
  specialDates: StoreSettings["special_dates"] = [],
): StoreSettings {
  return {
    ...(row as unknown as StoreSettings),
    hours: cleanHours(row.hours),
    schedule_min_hours: Number(row.schedule_min_hours ?? 24),
    schedule_max_days: Number(row.schedule_max_days ?? 60),
    schedule_view_days: Number(row.schedule_view_days ?? 60),
    zones: zones.map((z) => ({ ...z, fee: Number(z.fee) })),
    special_dates: specialDates,
    theme_palette: toPalette(row.theme_palette),
    festive_mode: toFestiveMode(row.festive_mode),
    festive_message: (row.festive_message as string | null) ?? null,
    festive_effects: row.festive_effects !== false,
    birthday_alert: row.birthday_alert !== false,
    birthday_days_before: Number(row.birthday_days_before ?? 0),
    birthday_message: (row.birthday_message as string | null) ?? null,
  };
}

/** Public menu: active categories with their visible products; stock-outs show as sold out. */
export async function getMenu(): Promise<MenuResult> {
  "use cache";
  // settings decide whether out-of-stock products stay orderable as scheduled orders
  cacheTag(MENU_TAG, SETTINGS_TAG);
  cacheLife("minutes");

  if (!isDatabaseConfigured) return { ok: false, error: "Banco de dados não configurado." };

  try {
    const [cats, prods, links, [settings]] = await Promise.all([
      query<Category>("select id, name, position, is_active from categories where is_active order by position, name"),
      query(`select ${PRODUCT_COLUMNS} from products where is_visible order by position, name`),
      query<StockLink & { stock: number }>(
        "select l.product_id, l.addon_id, l.item_id, l.quantity, i.quantity as stock from stock_links l join stock_items i on i.id = l.item_id",
      ),
      query<{ schedule_enabled: boolean }>("select schedule_enabled from store_settings where id = 1"),
    ]);
    const products = prods.map((r) => applyStock(productFromRow(r), links, settings?.schedule_enabled === true));
    const categories = cats
      .map((c) => ({
        ...c,
        products: products
          .filter((p) => p.category_id === c.id)
          .map((p) => ({ ...p, addon_groups: p.addon_groups.map((g) => ({ ...g, addons: g.addons.filter((a) => a.is_available) })) }))
          .sort(bySort),
      }))
      .filter((c) => c.products.length > 0);
    return { ok: true, categories };
  } catch (e) {
    console.error("getMenu failed", e);
    return { ok: false, error: "Erro ao carregar o cardápio." };
  }
}

export async function getStoreSettings(): Promise<StoreSettings | null> {
  "use cache";
  cacheTag(SETTINGS_TAG);
  cacheLife("minutes");

  if (!isDatabaseConfigured) return null;
  try {
    const [[row], zones, dates] = await Promise.all([
      query(`select ${SETTINGS_COLUMNS} from store_settings where id = 1`),
      query<DeliveryZone>(ZONES_SQL),
      query<StoreSettings["special_dates"][number]>(SPECIAL_DATES_SQL),
    ]);
    return row ? settingsFromRow(row, zones, dates) : null;
  } catch {
    return null;
  }
}

/**
 * Palette and festive theme for today, read by the root layout on every page.
 * Cached by the hour, so the calendar ("auto") switches themes on its own.
 */
export async function getActiveTheme(): Promise<ActiveTheme> {
  "use cache";
  cacheTag(SETTINGS_TAG);
  cacheLife("hours");

  if (!isDatabaseConfigured) return DEFAULT_THEME;
  try {
    const [row] = await query(
      "select theme_palette, festive_mode, festive_message, festive_effects from store_settings where id = 1",
    );
    if (!row) return DEFAULT_THEME;
    return activeTheme(
      {
        theme_palette: toPalette(row.theme_palette),
        festive_mode: toFestiveMode(row.festive_mode),
        festive_message: (row.festive_message as string | null) ?? null,
        festive_effects: row.festive_effects !== false,
      },
      spNow(new Date()).date,
    );
  } catch {
    return DEFAULT_THEME;
  }
}
