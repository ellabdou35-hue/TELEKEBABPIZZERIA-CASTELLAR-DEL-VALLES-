/* Prueba: la web calcula exactamente lo mismo que el servidor para TODA la carta real. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../site/js/pricing.js");
const { createOrder } = require("./server-port.js");
const menu = require("./fixtures/products.json").map((p) => ({ ...p, price: Number(p.price), active: true }));

// Generador determinista de personalizaciones válidas para cada producto.
function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
function pick(rnd, a) { return a[Math.floor(rnd() * a.length)]; }
function sample(rnd, a, max) { return a.filter(() => rnd() < 0.4).slice(0, max); }
function randomCustom(p, rnd) {
  const c = p.customization_config || {}, s = {};
  const drinks = P.drinkChoices(c, menu).map((d) => d.value);
  if (c.size_required) s.size = pick(rnd, c.sizes).name;
  if (c.meat_options?.length && !c.bundle_count && (c.meat_required || rnd() < 0.5)) s.meat_choice = pick(rnd, c.meat_options);
  if (c.side_options?.length && (c.side_required || rnd() < 0.5)) s.side_choice = pick(rnd, c.side_options);
  if (c.sauce_choice_options?.length && rnd() < 0.6) s.sauce_choice = pick(rnd, c.sauce_choice_options);
  if (c.drink_required) s.menu_drink = pick(rnd, drinks);
  if (c.extra_sauce_options?.length) s.extra_sauces = sample(rnd, c.extra_sauce_options, 4);
  if (c.allow_extra_ingredients) s.extra_ingredients = sample(rnd, P.extrasFor(p), 5);
  if (c.allow_removals) s.remove_ingredients = sample(rnd, P.removableFor(p), 5);
  s.extra_cheese = c.extra_cheese_price != null && rnd() < 0.5;
  if (c.bundle_count) s.unit_choices = Array.from({ length: c.bundle_count }, () => ({ style: pick(rnd, c.style_options), meat: pick(rnd, c.meat_options) }));
  if (c.pizza_count) s.pizza_flavors = Array.from({ length: c.pizza_count }, () => pick(rnd, c.pizza_flavor_options));
  if (c.drink_count) s.drink_choices = Array.from({ length: c.drink_count }, () => pick(rnd, drinks));
  s.notes = rnd() < 0.3 ? "Bien hecho" : "";
  return P.cleanCustom(p, s);
}
const base = { customer_name: "Prueba", phone: "600000000", fulfilment: "pickup", zone: "pickup", address: "", payment_method: "Efectivo", notes: "" };

test("101 productos reales: el precio de la web coincide con el del servidor (1.000 combinaciones)", () => {
  const rnd = seeded(42);
  let checked = 0;
  for (let round = 0; round < 10; round++) {
    for (const p of menu) {
      const custom = randomCustom(p, rnd);
      const err = P.validate(p, custom, menu);
      // Sin duplicados en sabores/bebidas: el servidor exige listas sin repetidos.
      const dupes = (a) => a && new Set(a).size !== a.length;
      const serverExpectsFail = dupes(custom.pizza_flavors) || dupes(custom.drink_choices);
      const [status, res] = createOrder({ ...base, items: [{ product_id: p.id, quantity: 2, customizations: custom }] }, menu);
      if (serverExpectsFail) { assert.equal(status, 400, p.name); continue; }
      assert.equal(err, "", `La web rechaza una combinación válida de ${p.name}: ${err}`);
      assert.equal(status, 200, `${p.name}: ${res.error} ${JSON.stringify(custom)}`);
      assert.equal(res.lines[0].unit_price, P.unitPrice(p, custom, menu), `${p.name} ${JSON.stringify(custom)}`);
      checked++;
    }
  }
  assert.ok(checked > 900, "combinaciones comprobadas: " + checked);
});

test("Gastos de envío y pedido mínimo idénticos al servidor en todas las zonas", () => {
  const coke = menu.find((p) => p.name === "Coca-Cola");
  for (const z of P.ZONES) {
    for (const qty of [1, 4, 5, 22, 23, 30]) {
      const line = { product: coke, customizations: P.cleanCustom(coke, {}), quantity: qty };
      const t = P.totals([line], "delivery", z.id, menu);
      const [status, res] = createOrder({ ...base, fulfilment: "delivery", zone: z.id, address: "Carrer Major 1", items: [{ product_id: coke.id, quantity: qty, customizations: line.customizations }] }, menu);
      if (t.missing > 0) assert.equal(status, 400, `${z.id} x${qty} debería rechazarse por mínimo`);
      else { assert.equal(status, 200, `${z.id} x${qty}: ${res.error}`); assert.equal(res.total, t.total); assert.equal(res.fee, t.fee); }
    }
  }
});

test("Tarifas comunicadas por el propietario", () => {
  assert.equal(P.deliveryFee("delivery", "castellar"), 1.5);
  ["sentmenat", "airesol_ab", "airesol_d", "sant_feliu"].forEach((z) => assert.equal(P.deliveryFee("delivery", z), 3));
  assert.equal(P.deliveryFee("delivery", "sant_llorenc_savall"), 10);
  assert.equal(P.minimumOrder("delivery", "sant_llorenc_savall"), 50);
  assert.equal(P.minimumOrder("delivery", "castellar"), 10);
  assert.equal(P.deliveryFee("pickup", "pickup"), 0);
  assert.equal(P.minimumOrder("pickup", "pickup"), 0);
});

test("Horario partido 11:30–16:00 y 18:00–23:00 (Europe/Madrid)", () => {
  const at = (h, m) => { // 17 nov 2026 es invierno: Madrid = UTC+1
    return new Date(Date.UTC(2026, 10, 17, h - 1, m));
  };
  assert.equal(P.openState(at(11, 29)).open, false);
  assert.equal(P.openState(at(11, 30)).open, true);
  assert.equal(P.openState(at(15, 59)).open, true);
  assert.equal(P.openState(at(16, 0)).open, false);
  assert.equal(P.openState(at(17, 0)).opensAt, "18:00");
  assert.equal(P.openState(at(22, 59)).open, true);
  assert.equal(P.openState(at(23, 0)).open, false);
  assert.equal(P.openState(at(23, 30)).tomorrow, true);
});

test("Validación: campos obligatorios", () => {
  const pizza = menu.find((p) => p.name === "Margarita");
  assert.match(P.validate(pizza, P.cleanCustom(pizza, {}), menu), /tamaño/);
  const menuDurum = menu.find((p) => p.name === "Menú dürüm kebab");
  assert.match(P.validate(menuDurum, P.cleanCustom(menuDurum, { meat_choice: "Pollo" }), menu), /bebida/);
  assert.match(P.validate(menuDurum, P.cleanCustom(menuDurum, { menu_drink: "Coca-Cola" }), menu), /carne/);
  assert.equal(P.validate(menuDurum, P.cleanCustom(menuDurum, { menu_drink: "Coca-Cola", meat_choice: "Pollo" }), menu), "");
});

test("Bebida de menú no incluida paga la diferencia (Red Bull en menú)", () => {
  const m = menu.find((p) => p.name === "Menú dürüm kebab");
  const c = P.cleanCustom(m, { meat_choice: "Pollo", menu_drink: "Red Bull" });
  assert.equal(P.unitPrice(m, c, menu), 9.3);
  const [, res] = createOrder({ ...base, items: [{ product_id: m.id, quantity: 1, customizations: c }] }, menu);
  assert.equal(res.total, 9.3);
});
