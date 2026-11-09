"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { RANGES, WIDGET, type LayoutItem, type Range, type ResolvedLayout } from "@/lib/dashboard-layout";
import { cn } from "@/lib/format";
import type { DashboardLayout } from "@/types";

const choice = (on: boolean) =>
  cn(
    "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors",
    on ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border-strong bg-surface text-muted-foreground hover:text-foreground",
  );
const arrow = "grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-surface-2 disabled:opacity-30";

/** "Personalizar": edits a draft of the manager's Dashboard; nothing changes until "Salvar". Mount it only while open. */
export function DashboardCustomizer({
  layout,
  onClose,
  onSave,
}: {
  layout: ResolvedLayout;
  onClose: () => void;
  onSave: (next: DashboardLayout | null) => Promise<boolean>;
}) {
  const [items, setItems] = useState<LayoutItem[]>(layout.items);
  const [range, setRange] = useState<Range>(layout.range);
  const [saving, setSaving] = useState(false);
  const shown = items.filter((it) => !it.hidden).length;

  const update = (index: number, patch: Partial<LayoutItem>) => setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const move = (index: number, dir: -1 | 1) =>
    setItems((list) => {
      const to = index + dir;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  async function save(next: DashboardLayout | null) {
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Personalizar dashboard"
      description="Escolha os blocos, a ordem e a largura. Vale só para a sua conta."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => save(null)} disabled={saving}>
            Restaurar padrão
          </Button>
          <Button onClick={() => save({ items, range })} loading={saving}>
            Salvar
          </Button>
        </div>
      }
    >
      <div className="space-y-6 px-5 pt-4 pb-5">
        <div>
          <p className="text-sm font-semibold">Abrir o dashboard em</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Período ao abrir">
            {RANGES.map((r) => (
              <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={range === r} className={choice(range === r)}>
                {r} dias
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold">Blocos</p>
          <p className="text-xs text-muted-foreground">As setas mudam a ordem. A largura vale em telas grandes.</p>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {items.map((it, i) => {
              const w = WIDGET[it.key];
              return (
                <li key={it.key} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={arrow} aria-label={`Subir ${w.label}`}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className={arrow} aria-label={`Descer ${w.label}`}>
                      <ArrowDown className="size-4" />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", it.hidden && "text-muted-foreground")}>{w.label}</p>
                    <p className="text-xs text-muted-foreground">{w.hint}</p>
                    {w.kind === "card" && !it.hidden && (
                      <div className="mt-2 flex gap-1.5" role="group" aria-label={`Largura de ${w.label}`}>
                        <button type="button" onClick={() => update(i, { full: false })} aria-pressed={!it.full} className={choice(!it.full)}>
                          Metade
                        </button>
                        <button type="button" onClick={() => update(i, { full: true })} aria-pressed={it.full} className={choice(it.full)}>
                          Inteira
                        </button>
                      </div>
                    )}
                  </div>
                  {/* the last visible block stays on: an empty Dashboard can't be saved */}
                  <Switch
                    checked={!it.hidden}
                    disabled={!it.hidden && shown === 1}
                    onCheckedChange={(on) => update(i, { hidden: !on })}
                    label={`Mostrar ${w.label}`}
                    hideLabel
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}
