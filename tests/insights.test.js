/* Asistente: no inventa datos y calcula sobre pedidos reales. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../site/js/insights.js");
const products = require("./fixtures/products.json");
const o = (day, hour, total, items, status = "completado") => ({ created_at: new Date(Date.UTC(2026, 10, day, hour - 1, 0)).toISOString(), total, status, fulfilment: "pickup", delivery_fee: 0, order_items: items.map((n) => ({ product_name: n, quantity: 1, line_total: 1 })) });

test("Con menos de 5 pedidos no saca conclusiones", () => {
  const s = I.salesSummary([o(16, 13, 10, ["A"])], 30);
  assert.equal(s.enough, false);
  assert.match(s.text[0], /al menos 5/);
});
test("KPIs: hoy, semana desde el lunes y mes, sin contar cancelados", () => {
  const now = new Date(Date.UTC(2026, 10, 17, 12)); // martes 17/11
  const k = I.kpis([o(17, 13, 10, ["A"]), o(17, 14, 5, ["A"], "cancelado"), o(16, 20, 20, ["B"]), o(15, 20, 7, ["B"]), o(2, 13, 3, ["C"])], now);
  assert.deepEqual([k.today.sales, k.today.n, k.week.sales, k.month.sales, k.cancelledToday], [10, 1, 30, 40, 1]);
});
test("Pares que se piden juntos", () => {
  const list = [o(10, 13, 1, ["Dürüm", "Coca-Cola"]), o(11, 13, 1, ["Dürüm", "Coca-Cola"]), o(12, 13, 1, ["Dürüm", "Patatas"]), o(13, 13, 1, ["Pizza"]), o(14, 13, 1, ["Pizza"])];
  const p = I.pairs(list, 5);
  assert.equal(p.pairs[0].a + "+" + p.pairs[0].b, "Coca-Cola+Dürüm");
  assert.equal(p.pairs[0].n, 2);
  assert.equal(p.pairs.length, 1);
});
test("Revisión de la carta real detecta nombres en minúscula y precios base incoherentes", () => {
  const a = I.audit(products, null).map((x) => x.tag);
  assert.ok(a.includes("Nombres"));
  assert.ok(a.includes("Precio"));
});
test("Descripción sugerida usa sólo datos del producto", () => {
  const d = I.describeProduct(products.find((p) => p.name === "Menú dürüm kebab"));
  assert.match(d, /pollo, ternera o mixta/); assert.match(d, /incluye bebida/);
});
