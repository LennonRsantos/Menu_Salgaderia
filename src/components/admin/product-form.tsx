"use client";

import { Package, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { saveProduct, type StockOption } from "@/actions/menu";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn, formatBRL, parseMoney } from "@/lib/format";
import { cleanImageUrl, type GroupDraft, type ProductDraft, type StockLinkDraft } from "@/lib/menu-admin";
import { formatQty } from "@/lib/stock";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { fieldErrors, productSchema } from "@/lib/validators";
import type { Category, Product, StockLink } from "@/types";
import { ProductImage } from "@/components/store/product-card";
import { ImageUpload } from "./image-upload";

const key = () => crypto.randomUUID();
const money = (n: number) => (Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "");

type MoneyText = { priceText: string };
type AddonForm = GroupDraft["addons"][number] & MoneyText;
type GroupForm = Omit<GroupDraft, "addons"> & { addons: AddonForm[] };
type StockRow = { key: string; addon_key: string | null; item_id: string; quantityText: string };

function toForm(product: Product | null, categoryId: string, nextPosition: number, links: StockLink[]) {
  return {
    name: product?.name ?? "",
    description: product?.description ?? "",
    priceText: product ? money(product.price) : "",
    category_id: product?.category_id ?? categoryId,
    image_url: product?.image_url ?? null,
    is_visible: product?.is_visible ?? true,
    is_available: product?.is_available ?? true,
    position: product?.position ?? nextPosition,
    sale_unit: product?.sale_unit ?? "",
    groups: (product?.addon_groups ?? []).map<GroupForm>((g) => ({
      key: g.id,
      id: g.id,
      name: g.name,
      min_select: g.min_select,
      max_select: g.max_select,
      addons: g.addons.map((a) => ({ key: a.id, id: a.id, name: a.name, price: a.price, priceText: money(a.price), is_available: a.is_available })),
    })),
    // the addon form key is the addon id, so addon links map straight across
    stock: links.map<StockRow>((l) => ({ key: key(), addon_key: l.addon_id, item_id: l.item_id, quantityText: formatQty(l.quantity) })),
  };
}

export function ProductFormSheet({
  open,
  product,
  categories,
  links,
  stockItems,
  saleUnits,
  defaultCategoryId,
  nextPosition,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  categories: Category[];
  links: StockLink[];
  stockItems: StockOption[];
  saleUnits: string[];
  defaultCategoryId: string;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} side="right" size="lg" title={product ? "Editar produto" : "Novo produto"}>
      {open && (
        <ProductForm
          key={product?.id ?? "new"}
          product={product}
          categories={categories}
          links={links}
          stockItems={stockItems}
          saleUnits={saleUnits}
          defaultCategoryId={defaultCategoryId}
          nextPosition={nextPosition}
          onCancel={onClose}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

function ProductForm({
  product,
  categories,
  links,
  stockItems,
  saleUnits,
  defaultCategoryId,
  nextPosition,
  onCancel,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  links: StockLink[];
  stockItems: StockOption[];
  saleUnits: string[];
  defaultCategoryId: string;
  nextPosition: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => toForm(product, defaultCategoryId, nextPosition, links));
  const [initial] = useState(() => JSON.stringify(form));
  const [saved, setSaved] = useState(false);
  useUnsavedChanges(!saved && JSON.stringify(form) !== initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  const updateGroup = (gk: string, patch: Partial<GroupForm>) =>
    setForm((f) => ({ ...f, groups: f.groups.map((g) => (g.key === gk ? { ...g, ...patch } : g)) }));

  const updateAddon = (gk: string, ak: string, patch: Partial<AddonForm>) =>
    setForm((f) => ({
      ...f,
      groups: f.groups.map((g) => (g.key === gk ? { ...g, addons: g.addons.map((a) => (a.key === ak ? { ...a, ...patch } : a)) } : g)),
    }));

  // estimated cost of one unit from the product's own stock links (options not included)
  const unitCost = form.stock
    .filter((r) => r.addon_key === null)
    .reduce((n, r) => n + (stockItems.find((i) => i.id === r.item_id)?.cost ?? 0) * (parseMoney(r.quantityText || "0") || 0), 0);
  const price = parseMoney(form.priceText || "");
  const margin = unitCost > 0 && price > 0 ? Math.round(((price - unitCost) / price) * 100) : null;

  const updateStock = (sk: string, patch: Partial<StockRow>) =>
    setForm((f) => ({ ...f, stock: f.stock.map((r) => (r.key === sk ? { ...r, ...patch } : r)) }));
  const addStock = (addon_key: string | null) =>
    setForm((f) => ({ ...f, stock: [...f.stock, { key: key(), addon_key, item_id: "", quantityText: "1" }] }));
  const removeStock = (sk: string) => setForm((f) => ({ ...f, stock: f.stock.filter((r) => r.key !== sk) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = productSchema.safeParse({
      name: form.name,
      description: form.description,
      price: form.priceText ? parseMoney(form.priceText) : NaN,
      category_id: form.category_id,
    });
    const errs = parsed.success ? {} : fieldErrors(parsed.error);
    if (form.image_url?.trim() && !cleanImageUrl(form.image_url)) errs.image_url = "Use um endereço que comece com https://";

    const groups: GroupDraft[] = [];
    for (const g of form.groups) {
      if (!g.name.trim()) errs[`group-${g.key}`] = "Dê um nome ao grupo.";
      if (g.addons.length === 0) errs[`group-${g.key}`] = "Adicione ao menos uma opção.";
      if (g.min_select > g.max_select) errs[`group-${g.key}`] = "O mínimo não pode ser maior que o máximo.";
      if (g.min_select > g.addons.length) errs[`group-${g.key}`] = "O mínimo é maior que o número de opções.";
      const addons = g.addons.map((a) => ({ ...a, price: parseMoney(a.priceText || "0") }));
      for (const a of addons) {
        if (!a.name.trim() || !Number.isFinite(a.price) || a.price < 0) errs[`group-${g.key}`] = "Revise nome e preço das opções.";
      }
      groups.push({ key: g.key, id: g.id, name: g.name, min_select: g.min_select, max_select: g.max_select, addons });
    }

    const addonKeys = new Set(form.groups.flatMap((g) => g.addons.map((a) => a.key)));
    const stock: StockLinkDraft[] = [];
    for (const r of form.stock) {
      if (r.addon_key !== null && !addonKeys.has(r.addon_key)) continue; // its addon was removed
      const quantity = parseMoney(r.quantityText || "0");
      if (!r.item_id || !Number.isFinite(quantity) || quantity <= 0) {
        errs.stock = "Escolha o item e uma quantidade maior que zero em cada linha de estoque.";
        continue;
      }
      stock.push({ addon_key: r.addon_key, item_id: r.item_id, quantity });
    }

    if (Object.keys(errs).length || !parsed.success) {
      setErrors(errs);
      toast.error("Revise os campos destacados.");
      return;
    }

    const draft: ProductDraft = {
      id: product?.id,
      ...parsed.data,
      image_url: cleanImageUrl(form.image_url),
      is_visible: form.is_visible,
      is_available: form.is_available,
      position: form.position,
      sale_unit: form.sale_unit || null,
      groups,
      stock,
    };

    setSaving(true);
    const result = await saveProduct(draft).catch(() => ({ ok: false as const, error: "Sem conexão. Tente novamente." }));
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(product ? "Produto atualizado." : "Produto criado.");
    setSaved(true);
    onSaved();
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-full flex-col">
      <div className="flex-1 space-y-6 px-5 py-5">
        <div className="flex gap-4">
          <div className="relative">
            <ProductImage
              product={{ image_url: cleanImageUrl(form.image_url), name: form.name }}
              className="size-28 shrink-0 rounded-lg border border-border"
            />
            {form.image_url && (
              <button
                type="button"
                onClick={() => set("image_url", null)}
                className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-border bg-surface shadow-sm hover:bg-surface-2"
                aria-label="Remover imagem"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <ImageUpload
            label="Foto"
            hint="Do celular ou do computador. Sem foto, aparece o ícone padrão."
            value={form.image_url}
            onChange={(url) => set("image_url", url)}
            maxSide={1200}
            error={errors.image_url}
            className="min-w-0 flex-1"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" error={errors.name} className="sm:col-span-2">
            {(p) => <Input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Coxinha de frango" />}
          </Field>
          <Field label="Descrição" optional error={errors.description} className="sm:col-span-2">
            {(p) => <Textarea {...p} value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} />}
          </Field>
          <Field label="Preço (R$)" error={errors.price}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.priceText}
                onChange={(e) => set("priceText", e.target.value.replace(/[^\d,.]/g, ""))}
                placeholder="0,00"
              />
            )}
          </Field>
          <Field label="Categoria" error={errors.category_id}>
            {(p) => (
              <Select {...p} value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
                <option value="">Selecione…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Vendido por" optional hint="Unidades em Configurações > Cardápio.">
            {(p) => (
              <Select {...p} value={form.sale_unit} onChange={(e) => set("sale_unit", e.target.value)}>
                <option value="">—</option>
                {/* a saved unit no longer in the list still shows */}
                {[...new Set([...saleUnits, ...(form.sale_unit ? [form.sale_unit] : [])])].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-6 rounded-md bg-surface-2 px-4 py-1">
          <Switch checked={form.is_visible} onCheckedChange={(v) => set("is_visible", v)} label="Visível no cardápio" />
          <Switch checked={form.is_available} onCheckedChange={(v) => set("is_available", v)} label="Disponível (não esgotado)" />
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Estoque</h3>
              <p className="text-sm text-muted-foreground">Cada unidade vendida baixa estes itens. Sem item, vende sem limite.</p>
            </div>
            {stockItems.length > 0 && (
              <Button variant="soft" size="sm" onClick={() => addStock(null)}>
                <Plus className="size-4" />
                Item
              </Button>
            )}
          </div>
          {stockItems.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-strong px-4 py-4 text-center text-sm text-muted-foreground">
              Nenhum item no estoque ainda.{" "}
              <Link href="/admin/estoque" className="font-semibold text-primary-soft-foreground hover:underline">
                Cadastrar itens
              </Link>
            </p>
          ) : (
            !form.stock.some((r) => r.addon_key === null) && (
              <p className="rounded-md border border-dashed border-border-strong px-4 py-4 text-center text-sm text-muted-foreground">
                Não baixa estoque.
              </p>
            )
          )}
          <ul className="space-y-2">
            {form.stock
              .filter((r) => r.addon_key === null)
              .map((r) => (
                <StockLine key={r.key} row={r} items={stockItems} onChange={(patch) => updateStock(r.key, patch)} onRemove={() => removeStock(r.key)} />
              ))}
          </ul>
          {errors.stock && <p className="text-xs font-medium text-danger">{errors.stock}</p>}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Adicionais e opções</h3>
              <p className="text-sm text-muted-foreground">Ex.: sabores, molhos, bebida do combo.</p>
            </div>
            <Button
              variant="soft"
              size="sm"
              onClick={() =>
                set("groups", [
                  ...form.groups,
                  { key: key(), name: "", min_select: 0, max_select: 1, addons: [{ key: key(), name: "", price: 0, priceText: "", is_available: true }] },
                ])
              }
            >
              <Plus className="size-4" />
              Grupo
            </Button>
          </div>

          {form.groups.length === 0 && (
            <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted-foreground">
              Sem adicionais. O cliente adiciona o produto direto.
            </p>
          )}

          {form.groups.map((g) => (
            <div key={g.key} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-start gap-2">
                <Input
                  aria-label="Nome do grupo"
                  value={g.name}
                  onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                  placeholder="Nome do grupo (ex.: Molhos)"
                  className="font-semibold"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => set("groups", form.groups.filter((x) => x.key !== g.key))}
                  aria-label={`Remover grupo ${g.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  Mínimo
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={g.min_select}
                    onChange={(e) => updateGroup(g.key, { min_select: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-9 w-18"
                  />
                </label>
                <label className="flex items-center gap-2">
                  Máximo
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={g.max_select}
                    onChange={(e) => updateGroup(g.key, { max_select: Math.max(1, Number(e.target.value) || 1) })}
                    className="h-9 w-18"
                  />
                </label>
                <span className="text-xs text-muted-foreground">{g.min_select > 0 ? "Obrigatório" : "Opcional"}</span>
              </div>
              <ul className="space-y-2">
                {g.addons.map((a) => (
                  <Fragment key={a.key}>
                    <li className="flex items-center gap-1.5">
                      {/* wrappers set the widths: Input is w-full */}
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label="Nome da opção"
                          value={a.name}
                          onChange={(e) => updateAddon(g.key, a.key, { name: e.target.value })}
                          placeholder="Opção"
                          className="h-10"
                        />
                      </div>
                      <div className="w-16 shrink-0">
                        <Input
                          aria-label="Preço adicional"
                          inputMode="decimal"
                          value={a.priceText}
                          onChange={(e) => updateAddon(g.key, a.key, { priceText: e.target.value.replace(/[^\d,.]/g, "") })}
                          placeholder="0,00"
                          className="h-10 px-2.5"
                        />
                      </div>
                      <Switch
                        checked={a.is_available}
                        onCheckedChange={(v) => updateAddon(g.key, a.key, { is_available: v })}
                        label={`${a.name || "Opção"} disponível`}
                        hideLabel
                      />
                      {stockItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => addStock(a.key)}
                          className={cn(
                            "grid size-9 shrink-0 place-items-center rounded-sm hover:bg-surface-2",
                            form.stock.some((r) => r.addon_key === a.key) ? "text-primary-soft-foreground" : "text-muted-foreground",
                          )}
                          aria-label={`Baixar estoque com ${a.name || "a opção"}`}
                          title="Baixar estoque com esta opção"
                        >
                          <Package className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => updateGroup(g.key, { addons: g.addons.filter((x) => x.key !== a.key) })}
                        className="grid size-9 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground"
                        aria-label={`Remover opção ${a.name}`}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                    {form.stock
                      .filter((r) => r.addon_key === a.key)
                      .map((r) => (
                        <StockLine
                          key={r.key}
                          row={r}
                          items={stockItems}
                          prefix={`${a.name || "Opção"} baixa`}
                          onChange={(patch) => updateStock(r.key, patch)}
                          onRemove={() => removeStock(r.key)}
                        />
                      ))}
                  </Fragment>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  updateGroup(g.key, { addons: [...g.addons, { key: key(), name: "", price: 0, priceText: "", is_available: true }] })
                }
                className="inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-primary-soft-foreground hover:underline"
              >
                <Plus className="size-4" />
                Adicionar opção
              </button>
              {errors[`group-${g.key}`] && <p className="text-xs font-medium text-danger">{errors[`group-${g.key}`]}</p>}
            </div>
          ))}
        </section>
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <span className="text-sm text-muted-foreground">
          {Number.isFinite(parseMoney(form.priceText)) && form.priceText ? `Preço base ${formatBRL(parseMoney(form.priceText))}` : ""}
          {unitCost > 0 && (
            <span className="block text-xs tabular-nums">
              Custo {formatBRL(unitCost)}
              {margin !== null && ` · margem ${margin}%`}
            </span>
          )}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Salvar produto
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Item picker grouped by stock category. */
function StockSelect({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: StockOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const categories = [...new Set(items.map((i) => i.category))];
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Escolha o item…</option>
      {categories.map((c) => (
        <optgroup key={c} label={c}>
          {items
            .filter((i) => i.category === c)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({formatQty(i.quantity)} {i.unit})
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

function StockLine({
  row,
  items,
  prefix,
  onChange,
  onRemove,
}: {
  row: StockRow;
  items: StockOption[];
  prefix?: string;
  onChange: (patch: Partial<StockRow>) => void;
  onRemove: () => void;
}) {
  const unit = items.find((i) => i.id === row.item_id)?.unit ?? "";
  return (
    <li className={cn("flex items-center gap-2", prefix && "rounded-md bg-surface-2 py-1.5 pr-1 pl-3")}>
      {prefix && <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      {/* wrappers set the widths: the controls are w-full */}
      <div className="min-w-0 flex-1">
        <StockSelect
          items={items}
          value={row.item_id}
          onChange={(item_id) => onChange({ item_id })}
          label={prefix ? `${prefix}: item do estoque` : "Item do estoque"}
          className={prefix ? "h-9" : "h-10"}
        />
      </div>
      <span className="shrink-0 text-sm text-muted-foreground" aria-hidden>
        ×
      </span>
      <div className="w-14 shrink-0">
        <Input
          aria-label="Quantidade baixada"
          inputMode="decimal"
          value={row.quantityText}
          onChange={(e) => onChange({ quantityText: e.target.value.replace(/[^\d,.]/g, "") })}
          className={cn("px-2 text-center", prefix ? "h-9" : "h-10")}
        />
      </div>
      <span className="w-6 shrink-0 text-xs text-muted-foreground">{unit}</span>
      <button
        type="button"
        onClick={onRemove}
        className="grid size-9 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground"
        aria-label="Remover item do estoque"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
