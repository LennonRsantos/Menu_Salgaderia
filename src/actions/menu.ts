"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { MENU_TAG, PRODUCT_COLUMNS, productFromRow } from "@/lib/menu";
import { cleanImageUrl, type ProductDraft } from "@/lib/menu-admin";
import { round2 } from "@/lib/stock";
import { productSchema } from "@/lib/validators";
import type { Category, Product, StockLink } from "@/types";

/** Stock items as the product form lists them. */
export interface StockOption {
  id: string;
  name: string;
  unit: string;
  category: string;
  quantity: number;
  cost: number;
}

export type MenuActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const UUID = z.uuid("Item não encontrado.");

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Dados inválidos." };
  const pgError = e as { code?: string; constraint?: string };
  if (pgError?.code === "23503") {
    return {
      ok: false,
      error:
        pgError.constraint === "stock_links_item_id_fkey"
          ? "Um item do estoque escolhido foi excluído. Feche e abra o produto de novo."
          : "Mova ou exclua os produtos desta categoria antes.",
    };
  }
  return { ok: false, error: e instanceof Error ? e.message : "Erro inesperado." };
};

/** Every menu change refreshes the cached public menu right away. */
async function staffWrite<T>(fn: () => Promise<T>): Promise<MenuActionResult<T>> {
  try {
    await requireStaff();
    const data = await fn();
    updateTag(MENU_TAG);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function fetchMenuAdmin(): Promise<
  MenuActionResult<{ categories: Category[]; products: Product[]; links: StockLink[]; stockItems: StockOption[]; saleUnits: string[] }>
> {
  try {
    await requireStaff();
    const [categories, products, links, stockItems, [settings]] = await Promise.all([
      query<Category>("select id, name, position, is_active from categories order by position, name"),
      query(`select ${PRODUCT_COLUMNS} from products order by position, name`),
      query<StockLink>("select product_id, addon_id, item_id, quantity from stock_links order by id"),
      query<StockOption>(
        `select i.id, i.name, i.unit, i.quantity, i.cost, c.name as category from stock_items i join stock_categories c on c.id = i.category_id
          order by c.position, c.name, i.name`,
      ),
      query<{ sale_units: string[] }>("select sale_units from store_settings where id = 1"),
    ]);
    return {
      ok: true,
      data: { categories, products: products.map(productFromRow), links, stockItems, saleUnits: settings?.sale_units ?? [] },
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Saves a product with its addon groups in the same row, so the whole edit is
 * a single atomic write. Past orders keep their own snapshot.
 */
export async function saveProduct(draft: ProductDraft) {
  return staffWrite(async () => {
    const base = productSchema.parse({
      name: draft.name,
      description: draft.description ?? "",
      price: draft.price,
      category_id: draft.category_id,
    });
    UUID.parse(base.category_id);
    const count = z.number().int().min(0).max(50);
    const groups = (draft.groups ?? []).slice(0, 20).map((g, gi) => ({
      id: g.id ?? crypto.randomUUID(),
      name: String(g.name ?? "").trim().slice(0, 80),
      min_select: count.parse(g.min_select),
      max_select: count.parse(g.max_select),
      position: gi,
      addons: (g.addons ?? []).slice(0, 50).map((a, ai) => ({
        id: a.id ?? crypto.randomUUID(),
        name: String(a.name ?? "").trim().slice(0, 80),
        price: z.number().min(0).max(100000).parse(a.price),
        is_available: a.is_available !== false,
        position: ai,
      })),
    }));
    // addon links arrive keyed by the form's addon key; new addons only get their id above
    const addonIds = new Map(groups.flatMap((g, gi) => g.addons.map((a, ai) => [draft.groups[gi].addons[ai].key, a.id] as const)));
    const qty = z.number().positive("Quantidade de estoque inválida.").max(100000);
    const links = new Map<string, { addon_id: string | null; item_id: string; quantity: number }>();
    for (const l of (draft.stock ?? []).slice(0, 100)) {
      const addon_id = l.addon_key === null ? null : addonIds.get(l.addon_key);
      if (addon_id === undefined) continue; // the addon was removed in this edit
      const item_id = UUID.parse(l.item_id);
      const k = `${addon_id ?? ""}:${item_id}`;
      links.set(k, { addon_id, item_id, quantity: round2((links.get(k)?.quantity ?? 0) + qty.parse(l.quantity)) });
    }

    const values = [
      base.category_id,
      base.name,
      base.description || null,
      base.price,
      cleanImageUrl(draft.image_url),
      draft.is_visible !== false,
      draft.is_available !== false,
      Number.isFinite(draft.position) ? Math.floor(draft.position) : 0,
      JSON.stringify(groups),
      String(draft.sale_unit ?? "").trim().slice(0, 30) || null,
    ];

    return transaction(async (db) => {
      let id: string;
      if (draft.id) {
        const { rows } = await db.query<{ id: string }>(
          `update products set category_id = $2, name = $3, description = $4, price = $5, image_url = $6,
             is_visible = $7, is_available = $8, position = $9, addon_groups = $10, sale_unit = $11, updated_at = now()
           where id = $1 returning id`,
          [UUID.parse(draft.id), ...values],
        );
        if (!rows[0]) throw new Error("Produto não encontrado.");
        id = rows[0].id;
      } else {
        const { rows } = await db.query<{ id: string }>(
          `insert into products (category_id, name, description, price, image_url, is_visible, is_available, position, addon_groups, sale_unit)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          values,
        );
        id = rows[0].id;
      }

      // links are replaced as a whole, so links of removed addons go away too
      const list = [...links.values()];
      await db.query("delete from stock_links where product_id = $1", [id]);
      await db.query(
        `insert into stock_links (product_id, addon_id, item_id, quantity)
         select $1, l.addon_id, l.item_id, l.quantity from unnest($2::text[], $3::uuid[], $4::numeric[]) as l(addon_id, item_id, quantity)`,
        [id, list.map((l) => l.addon_id), list.map((l) => l.item_id), list.map((l) => l.quantity)],
      );
      return id;
    });
  });
}

export async function setProductFlag(id: string, field: "is_visible" | "is_available", value: boolean) {
  return staffWrite(async () => {
    const column = z.enum(["is_visible", "is_available"]).parse(field);
    await query(`update products set ${column} = $2, updated_at = now() where id = $1`, [UUID.parse(id), Boolean(value)]);
  });
}

export async function deleteProduct(id: string) {
  return staffWrite(async () => {
    await query("delete from products where id = $1", [UUID.parse(id)]);
  });
}

const categoryName = z.string().trim().min(1, "Informe o nome.").max(60);

export async function createCategory(name: string) {
  return staffWrite(async () => {
    await query("insert into categories (name, position) values ($1, (select coalesce(max(position), 0) + 1 from categories))", [
      categoryName.parse(name),
    ]);
  });
}

export async function updateCategory(id: string, patch: { name?: string; is_active?: boolean }) {
  return staffWrite(async () => {
    await query("update categories set name = coalesce($2, name), is_active = coalesce($3, is_active) where id = $1", [
      UUID.parse(id),
      patch.name === undefined ? null : categoryName.parse(patch.name),
      patch.is_active === undefined ? null : Boolean(patch.is_active),
    ]);
  });
}

/** Swaps the order of two categories, renumbering all of them 1..n. */
export async function swapCategories(aId: string, bId: string) {
  return staffWrite(() =>
    transaction(async (db) => {
      const ids = (await db.query<{ id: string }>("select id from categories order by position, name for update")).rows.map((r) => r.id);
      const a = ids.indexOf(UUID.parse(aId));
      const b = ids.indexOf(UUID.parse(bId));
      if (a < 0 || b < 0) throw new Error("Categoria não encontrada.");
      [ids[a], ids[b]] = [ids[b], ids[a]];
      await db.query(
        "update categories c set position = o.n from unnest($1::uuid[]) with ordinality as o(id, n) where c.id = o.id",
        [ids],
      );
    }),
  );
}

export async function deleteCategory(id: string) {
  // the products foreign key refuses to delete a category that still has products
  return staffWrite(async () => {
    await query("delete from categories where id = $1", [UUID.parse(id)]);
  });
}
