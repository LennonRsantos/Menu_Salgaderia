// Checks the Dashboard layout rules (src/lib/dashboard-layout.ts).
// Usage: node scripts/check-dashboard-layout.mjs  (Node 22.6+ runs the .ts directly)
import assert from "node:assert/strict";
import { layoutError, PARTS, partsOf, resolveLayout, WIDGET_KEYS } from "../src/lib/dashboard-layout.ts";

// nothing saved: every block, default order, visible, half width, 30 days
const def = resolveLayout(null);
assert.deepEqual(
  def.items.map((i) => i.key),
  WIDGET_KEYS,
);
assert.ok(def.items.every((i) => !i.hidden && !i.full));
assert.equal(def.range, 30);
assert.deepEqual(partsOf(def.items), [...PARTS]);

// saved order kept; unknown and repeated blocks dropped; tiles never full; missing blocks appended
const saved = resolveLayout({
  items: [{ key: "profit", hidden: true }, { key: "gone" }, { key: "profit" }, { key: "cash", full: true }, { key: "kpi_today", full: true }],
  range: 7,
});
assert.deepEqual(saved.items.slice(0, 3), [
  { key: "profit", hidden: true, full: false },
  { key: "cash", hidden: false, full: true },
  { key: "kpi_today", hidden: false, full: false },
]);
assert.equal(saved.items.length, WIDGET_KEYS.length);
assert.equal(saved.range, 7);
assert.equal(resolveLayout({ items: [], range: 14 }).range, 30);

// only the data of the visible blocks; "cash" loads its own
const only = (key) => resolveLayout({ items: WIDGET_KEYS.map((k) => ({ key: k, hidden: k !== key })) }).items;
assert.deepEqual(partsOf(only("kpi_today")), ["metrics"]);
assert.deepEqual(partsOf(only("cash")), []);

// what the server refuses
assert.equal(layoutError({ items: [{ key: "cash" }], range: 90 }), null);
assert.equal(layoutError({ items: [{ key: "gone" }] }), "Bloco desconhecido.");
assert.equal(layoutError({ items: [{ key: "cash" }, { key: "cash" }] }), "Bloco repetido.");
assert.equal(layoutError({ items: [{ key: "cash", hidden: true }] }), "Deixe ao menos um bloco visível.");
assert.equal(layoutError({ items: [{ key: "cash" }], range: 14 }), "Período inválido.");
assert.equal(layoutError({ items: "x" }), "Layout inválido.");

console.log("dashboard-layout: ok");
