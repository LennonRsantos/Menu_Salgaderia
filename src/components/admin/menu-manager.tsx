"use client";

import { FolderCog, Package, Pencil, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ProductImage } from "@/components/store/product-card";
import { cn, formatBRL, normalizeSearch, priceLabel } from "@/lib/format";
import {
  createCategory,
  deleteCategory,
  deleteProduct,
  fetchMenuAdmin,
  setProductFlag,
  swapCategories,
  updateCategory,
  type StockOption,
} from "@/actions/menu";
import type { Category, Product, StockLink } from "@/types";
import { CategoryManager, type CategoryApi } from "./category-manager";
import { PageHeader } from "./panel-shell";
import { ProductFormSheet } from "./product-form";

const MENU_CATEGORY_API: CategoryApi = {
  create: createCategory,
  rename: (id, name) => updateCategory(id, { name }),
  remove: deleteCategory,
  swap: swapCategories,
  setActive: (id, is_active) => updateCategory(id, { is_active }),
};

type MenuData = { categories: Category[]; products: Product[]; links: StockLink[]; stockItems: StockOption[]; saleUnits: string[] };

export function MenuManager() {
  const [data, setData] = useState<MenuData | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchMenuAdmin().catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    if (result.ok) {
      setData(result.data);
    } else {
      toast.error(result.error);
      setData((d) => d ?? { categories: [], products: [], links: [], stockItems: [], saleUnits: [] });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const q = normalizeSearch(query);
    return data.categories
      .filter((c) => filter === "all" || c.id === filter)
      .map((c) => ({
        category: c,
        products: data.products.filter(
          (p) => p.category_id === c.id && (!q || normalizeSearch(`${p.name} ${p.description ?? ""}`).includes(q)),
        ),
      }))
      // while searching, hide categories without matches; otherwise show empty ones too
      .filter((g) => g.products.length > 0 || !q);
  }, [data, query, filter]);

  async function toggle(product: Product, field: "is_visible" | "is_available", value: boolean) {
    setData((d) => d && { ...d, products: d.products.map((p) => (p.id === product.id ? { ...p, [field]: value } : p)) });
    const result = await setProductFlag(product.id, field, value).catch(() => ({ ok: false as const, error: "Sem conexão." }));
    if (!result.ok) {
      toast.error(result.error);
      setData((d) => d && { ...d, products: d.products.map((p) => (p.id === product.id ? product : p)) });
      return;
    }
    toast.success(
      field === "is_visible"
        ? `${product.name} ${value ? "visível" : "oculto"} no cardápio.`
        : `${product.name} ${value ? "disponível" : "marcado como esgotado"}.`,
    );
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    const result = await deleteProduct(toDelete.id).catch(() => ({ ok: false as const, error: "Sem conexão." }));
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Produto excluído.");
    setToDelete(null);
    load();
  }

  const openNew = () => {
    if (!data?.categories.length) {
      toast.info("Crie uma categoria primeiro.");
      setCategoriesOpen(true);
      return;
    }
    setEditing(null);
    setFormOpen(true);
  };

  /** Units of the product the stock still covers; null when it has no stock links. */
  const unitsInStock = (productId: string) => {
    const own = data?.links.filter((l) => l.product_id === productId && l.addon_id === null) ?? [];
    if (own.length === 0) return null;
    return Math.min(...own.map((l) => Math.floor((data?.stockItems.find((i) => i.id === l.item_id)?.quantity ?? 0) / l.quantity)));
  };

  const defaultCategoryId = filter !== "all" ? filter : (data?.categories[0]?.id ?? "");
  const nextPosition = Math.max(0, ...(data?.products ?? []).filter((p) => p.category_id === defaultCategoryId).map((p) => p.position)) + 1;

  return (
    <div className="pb-8">
      <PageHeader
        title="Cardápio"
        description="Crie, edite, pause ou oculte produtos. Mudanças aparecem no link público em instantes."
        actions={
          <>
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <FolderCog className="size-4" />
              Categorias
            </Button>
            <Button onClick={openNew}>
              <Plus className="size-4" />
              Novo produto
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-6">
        <label className="relative sm:max-w-sm">
          <span className="sr-only">Buscar produto</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto"
            className="h-10 w-full rounded-md border border-border-strong bg-surface pr-3 pl-9 text-base focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none sm:text-sm"
          />
        </label>
        {data && data.categories.length > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {[{ id: "all", name: "Todas" }, ...data.categories].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                aria-pressed={filter === c.id}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  filter === c.id
                    ? "border-primary bg-primary-soft text-primary-soft-foreground"
                    : "border-border-strong bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6 px-4 sm:px-6">
        {!data ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)
        ) : data.categories.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="Comece pelas categorias"
            description="Crie categorias como “Salgados fritos” e “Bebidas” para organizar o cardápio."
            action={<Button onClick={() => setCategoriesOpen(true)}>Criar categoria</Button>}
          />
        ) : grouped.every((g) => g.products.length === 0) && query ? (
          <EmptyState icon={Search} title="Nenhum produto encontrado" />
        ) : (
          grouped.map(({ category, products }) => (
            <section key={category.id} aria-labelledby={`mc-${category.id}`}>
              <div className="mb-2 flex items-center gap-2">
                <h2 id={`mc-${category.id}`} className="font-bold">
                  {category.name}
                </h2>
                {!category.is_active && <Badge tone="warning">Categoria oculta</Badge>}
                <span className="text-sm text-muted-foreground">· {products.length}</span>
              </div>
              <Card className="divide-y divide-border overflow-hidden">
                {products.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum produto nesta categoria.</p>}
                {products.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                    <ProductImage product={p} className={cn("size-14 shrink-0 rounded-md", !p.is_available && "grayscale")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="font-semibold tabular-nums">{priceLabel(p.price, p.sale_unit)}</span>
                        {p.addon_groups.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            · {p.addon_groups.length} {p.addon_groups.length === 1 ? "grupo" : "grupos"} de adicionais
                          </span>
                        )}
                        {!p.is_visible && <Badge>Oculto</Badge>}
                        {!p.is_available && <Badge tone="danger">Esgotado</Badge>}
                        {p.is_available && <StockBadge units={unitsInStock(p.id)} />}
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-end">
                      <Switch checked={p.is_visible} onCheckedChange={(v) => toggle(p, "is_visible", v)} label="Visível" className="sm:pr-2" />
                      <Switch checked={p.is_available} onCheckedChange={(v) => toggle(p, "is_available", v)} label="Disponível" className="sm:pr-2" />
                      {/* phones: smaller icon buttons so the row fits at 360 px */}
                      <div className="flex">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="sm:size-11 sm:rounded-md"
                          onClick={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                          aria-label={`Editar ${p.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="sm:size-11 sm:rounded-md" onClick={() => setToDelete(p)} aria-label={`Excluir ${p.name}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>

      {data && (
        <>
          <ProductFormSheet
            open={formOpen}
            product={editing}
            categories={data.categories}
            links={editing ? data.links.filter((l) => l.product_id === editing.id) : []}
            stockItems={data.stockItems}
            saleUnits={data.saleUnits}
            defaultCategoryId={defaultCategoryId}
            nextPosition={nextPosition}
            onClose={() => setFormOpen(false)}
            onSaved={() => {
              setFormOpen(false);
              load();
            }}
          />
          <CategoryManager
            open={categoriesOpen}
            onClose={() => setCategoriesOpen(false)}
            categories={data.categories}
            countFor={(id) => data.products.filter((p) => p.category_id === id).length}
            api={MENU_CATEGORY_API}
            description="Organize a ordem em que aparecem no cardápio."
            noun={["produto", "produtos"]}
            onChanged={load}
          />
        </>
      )}
      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        loading={deleting}
        title={`Excluir “${toDelete?.name}”?`}
        description="O produto sai do cardápio definitivamente. Pedidos antigos continuam com o registro. Para tirar temporariamente, use “Visível” ou “Disponível”."
        confirmLabel="Excluir produto"
      />
    </div>
  );
}

function StockBadge({ units }: { units: number | null }) {
  if (units === null) return null;
  return units > 0 ? (
    <Badge>
      <Package className="size-3" aria-hidden />
      {units} em estoque
    </Badge>
  ) : (
    <Badge tone="danger">
      <Package className="size-3" aria-hidden />
      Sem estoque
    </Badge>
  );
}
