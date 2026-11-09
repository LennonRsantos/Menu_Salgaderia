"use client";

import { Croissant, Plus } from "lucide-react";
import { cn, priceLabel } from "@/lib/format";
import type { Product } from "@/types";

export function ProductImage({ product, className }: { product: Pick<Product, "image_url" | "name">; className?: string }) {
  if (product.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- images are external links set in the panel
      <img
        src={product.image_url}
        alt={product.name}
        width={112}
        height={112}
        loading="lazy"
        decoding="async"
        className={cn("object-cover", className)}
      />
    );
  }
  return (
    <div className={cn("grid place-items-center bg-primary-soft text-primary-soft-foreground", className)} aria-hidden>
      <Croissant className="size-1/3 min-h-6 min-w-6 opacity-70" strokeWidth={1.5} />
    </div>
  );
}

export function ProductCard({ product, onSelect }: { product: Product; onSelect: () => void }) {
  const soldOut = !product.is_available;
  const fromPrice = product.addon_groups.some((g) => g.min_select > 0 && g.addons.some((a) => a.price > 0));

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={soldOut}
      className={cn(
        "group flex w-full items-stretch gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-150",
        soldOut ? "cursor-not-allowed" : "hover:border-primary/40 hover:shadow-md active:scale-[0.99]",
      )}
      aria-label={`${product.name}, ${priceLabel(product.price, product.sale_unit)}${soldOut ? ", esgotado" : product.stock_out ? ", só por encomenda" : ""}`}
    >
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1 py-0.5", soldOut && "opacity-60")}>
        <h3 className="font-semibold leading-snug">{product.name}</h3>
        {product.description && <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="font-bold tabular-nums">
            {fromPrice && <span className="mr-1 text-xs font-medium text-muted-foreground">a partir de</span>}
            {priceLabel(product.price, product.sale_unit)}
          </span>
          {soldOut && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">Esgotado</span>
          )}
          {!soldOut && product.stock_out && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold">Só por encomenda</span>
          )}
        </div>
      </div>
      <div className="relative shrink-0">
        <ProductImage product={product} className={cn("size-24 rounded-md sm:size-28", soldOut && "grayscale")} />
        {!soldOut && (
          <span className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full border-2 border-surface bg-primary text-primary-foreground shadow-sm transition-transform group-hover:scale-110">
            <Plus className="size-4" strokeWidth={2.5} />
          </span>
        )}
      </div>
    </button>
  );
}
