"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { QuantityStepper } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useCart } from "@/lib/cart-store";
import { cn, formatBRL, priceLabel } from "@/lib/format";
import type { AddonGroup, Product } from "@/types";
import { ProductImage } from "./product-card";

export function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(product)} onClose={onClose} title={product?.name ?? ""} bare size="md">
      {product && <ProductCustomizer key={product.id} product={product} onDone={onClose} />}
    </Sheet>
  );
}

function groupRule(g: AddonGroup) {
  if (g.max_select === 1) return g.min_select === 1 ? "Escolha 1 opção" : "Escolha até 1 opção";
  if (g.min_select > 0 && g.min_select === g.max_select) return `Escolha ${g.min_select} opções`;
  if (g.min_select > 0) return `Escolha de ${g.min_select} a ${g.max_select}`;
  return `Escolha até ${g.max_select}`;
}

function ProductCustomizer({ product, onDone }: { product: Product; onDone: () => void }) {
  const add = useCart((s) => s.add);
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const groups = product.addon_groups.filter((g) => g.addons.length > 0);

  const chosen = useMemo(
    () => groups.flatMap((g) => g.addons.filter((a) => selection[g.id]?.includes(a.id))),
    [groups, selection],
  );
  const unitPrice = product.price + chosen.reduce((n, a) => n + a.price, 0);
  const missing = groups.find((g) => (selection[g.id]?.length ?? 0) < g.min_select);

  function toggle(group: AddonGroup, addonId: string) {
    setSelection((prev) => {
      const current = prev[group.id] ?? [];
      if (group.max_select === 1) {
        // radio behaviour; optional single-choice groups can be cleared by tapping again
        const next = current[0] === addonId && group.min_select === 0 ? [] : [addonId];
        return { ...prev, [group.id]: next };
      }
      if (current.includes(addonId)) return { ...prev, [group.id]: current.filter((id) => id !== addonId) };
      if (current.length >= group.max_select) {
        toast.info(`Máximo de ${group.max_select} em “${group.name}”.`);
        return prev;
      }
      return { ...prev, [group.id]: [...current, addonId] };
    });
  }

  function submit() {
    if (missing) {
      document.getElementById(`group-${missing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.warning(`Escolha uma opção em “${missing.name}”.`);
      return;
    }
    add({
      productId: product.id,
      name: product.name,
      imageUrl: product.image_url,
      unitPrice,
      quantity,
      addons: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      notes: notes.trim(),
      scheduleOnly: product.stock_out === true,
    });
    toast.success(`${quantity}× ${product.name} adicionado ao carrinho`);
    onDone();
  }

  return (
    <div className="flex flex-col">
      <ProductImage product={product} className="aspect-[16/10] w-full sm:aspect-[16/8]" />
      <div className="space-y-2 px-5 pt-5 pb-4">
        <h3 className="text-2xl font-bold tracking-tight">{product.name}</h3>
        {product.description && <p className="text-muted-foreground">{product.description}</p>}
        <p className="text-lg font-bold tabular-nums">{priceLabel(product.price, product.sale_unit)}</p>
        {product.stock_out && (
          <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">
            <strong>Esgotado hoje.</strong> Você pode encomendar para outro dia: escolha a data ao finalizar o pedido.
          </p>
        )}
      </div>

      {groups.map((g) => {
        const count = selection[g.id]?.length ?? 0;
        const satisfied = count >= g.min_select;
        return (
          <fieldset key={g.id} id={`group-${g.id}`} className="border-t border-border">
            <legend className="sr-only">{g.name}</legend>
            <div className="flex items-center justify-between gap-3 bg-surface-2 px-5 py-3">
              <div>
                <p className="font-semibold">{g.name}</p>
                <p className="text-xs text-muted-foreground">{groupRule(g)}</p>
              </div>
              {g.min_select > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    satisfied ? "bg-success-soft text-success-soft-foreground" : "bg-foreground text-background",
                  )}
                >
                  {satisfied ? <Check className="size-3" /> : null}
                  {satisfied ? "Ok" : "Obrigatório"}
                </span>
              )}
            </div>
            <ul className="divide-y divide-border">
              {g.addons.map((a) => {
                const checked = selection[g.id]?.includes(a.id) ?? false;
                const single = g.max_select === 1;
                return (
                  <li key={a.id}>
                    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2/60">
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{a.name}</span>
                        {a.price > 0 && <span className="text-sm text-muted-foreground tabular-nums">+ {formatBRL(a.price)}</span>}
                      </span>
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={`g-${g.id}`}
                        checked={checked}
                        onChange={() => toggle(g, a.id)}
                        onClick={(e) => {
                          // allow un-checking an optional radio
                          if (single && checked && g.min_select === 0) {
                            e.preventDefault();
                            toggle(g, a.id);
                          }
                        }}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                          single ? "rounded-full" : "rounded-sm",
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
                        )}
                        aria-hidden
                      >
                        {checked && (single ? <span className="size-2 rounded-full bg-primary-foreground" /> : <Check className="size-4" strokeWidth={3} />)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      <div className="space-y-2 border-t border-border px-5 py-5">
        <label htmlFor="item-notes" className="text-sm font-semibold">
          Alguma observação?
        </label>
        <Textarea
          id="item-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 140))}
          placeholder="Ex.: bem passado, sem cebola…"
          rows={2}
        />
        <p className="text-right text-xs text-muted-foreground tabular-nums">{notes.length}/140</p>
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-surface px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <QuantityStepper value={quantity} onChange={setQuantity} />
        <Button size="lg" className="flex-1 justify-between" onClick={submit} aria-disabled={Boolean(missing)}>
          <span>Adicionar</span>
          <span className="tabular-nums">{formatBRL(unitPrice * quantity)}</span>
        </Button>
      </div>
    </div>
  );
}
