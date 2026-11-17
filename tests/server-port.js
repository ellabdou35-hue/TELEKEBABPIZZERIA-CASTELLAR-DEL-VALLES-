/*
 * Port fiel (línea a línea) de la validación y cálculo de la Edge Function `create-order`
 * desplegada en producción (versión 14). Se usa SÓLO en pruebas, para comprobar que lo que
 * muestra la web coincide con lo que cobraría el servidor, sin crear pedidos reales.
 */
"use strict";

const zoneFees = { castellar: 1.5, sentmenat: 3, airesol_ab: 3, airesol_d: 3, sant_feliu: 3, sant_llorenc_savall: 10 };
const validTables = ["S1", "S2", "S3", "S4", "T1", "T2", "T3", "T4"];
const allowedKeys = new Set(["size", "menu_drink", "meat_choice", "side_choice", "sauce_choice", "extra_sauces", "extra_ingredients", "remove_ingredients", "extra_cheese", "only_meat", "unit_choices", "pizza_flavors", "drink_choices", "fixed_drink", "notes"]);
class InvalidCustomization extends Error {}
function cleanList(value, max, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new InvalidCustomization("Personalización no válida: " + label);
  const result = value.map((x) => String(x).trim());
  if (result.some((x) => !x || x.length > 80) || new Set(result).size !== result.length) throw new InvalidCustomization("Personalización no válida: " + label);
  return result;
}

function createOrder(body, allProducts) {
  const name = String(body.customer_name || "").trim().slice(0, 100);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const fulfilment = body.fulfilment, zone = String(body.zone || ""), address = String(body.address || "").trim().slice(0, 300);
  const tableNumber = String(body.table_number || "").trim().toUpperCase();
  const payment = body.payment_method, items = body.items;
  if (name.length < 2 || phone.length < 6) return [400, { ok: false, error: "Nombre o teléfono no válidos" }];
  if (!["delivery", "pickup", "dine_in"].includes(fulfilment)) return [400, { ok: false, error: "Tipo de pedido no válido" }];
  if (!["Efectivo", "Tarjeta física en TPV"].includes(payment)) return [400, { ok: false, error: "Forma de pago no válida" }];
  if (fulfilment === "delivery" && (!Object.hasOwn(zoneFees, zone) || address.length < 5)) return [400, { ok: false, error: "Selecciona una zona de reparto válida e indica la dirección completa" }];
  if (fulfilment === "pickup" && zone !== "pickup") return [400, { ok: false, error: "Zona de recogida no válida" }];
  if (fulfilment === "dine_in" && !validTables.includes(tableNumber)) return [400, { ok: false, error: "Elige tu mesa" }];
  if (!Array.isArray(items) || items.length < 1 || items.length > 40) return [400, { ok: false, error: "El carrito no es válido" }];
  const products = allProducts;
  const drinkRows = allProducts.filter((p) => ["Bebidas", "Otras bebidas", "Cervezas y vinos"].includes(p.family) && p.active);
  const activeDrinks = new Set(drinkRows.map((d) => String(d.name)));
  const drinkPrice = new Map(drinkRows.map((d) => [String(d.name), Number(d.price)]));
  const drinkExtra = (cfg, n) => {
    if (Array.isArray(cfg.drink_options) && cfg.drink_options.includes(n)) return 0;
    const base = Number(cfg.drink_base_price ?? 2.2);
    return Math.max(0, Math.round(((drinkPrice.get(n) ?? 0) - base) * 100) / 100);
  };
  const lines = []; let subtotal = 0;
  try {
    for (const item of items) {
      const product = products.find((p) => p.id === String(item.product_id));
      const qty = Number(item.quantity);
      if (!product || !product.active || !Number.isInteger(qty) || qty < 1 || qty > 30) return [400, { ok: false, error: "Un producto ya no está disponible o la cantidad no es válida" }];
      const custom = item.customizations ?? {};
      if (!custom || typeof custom !== "object" || Array.isArray(custom) || Object.keys(custom).some((k) => !allowedKeys.has(k))) return [400, { ok: false, error: "Personalización no válida" }];
      const cfg = product.customization_config || {};
      const fail = (m) => [400, { ok: false, error: m }];
      const has = (k) => Object.prototype.hasOwnProperty.call(custom, k);
      let unitPrice = Number(product.price);
      if (cfg.size_required) {
        const size = String(custom.size || "");
        const choice = Array.isArray(cfg.sizes) ? cfg.sizes.find((x) => x.name === size) : null;
        if (!choice) return fail("El tamaño elegido no es válido");
        unitPrice = Number(choice.price);
      } else if (has("size")) return fail("Este producto no admite tamaño");
      if (cfg.drink_required) {
        const md = String(custom.menu_drink || "");
        if (!md || !activeDrinks.has(md)) return fail("Elige una bebida disponible para el menú");
        unitPrice += drinkExtra(cfg, md);
      } else if (has("menu_drink")) return fail("Este producto no incluye elección de bebida");
      if (Array.isArray(cfg.meat_options) && cfg.meat_options.length) {
        const m = String(custom.meat_choice || "");
        if (cfg.meat_required && !cfg.meat_options.includes(m)) return fail("El tipo de carne no es válido");
        if (m && !cfg.meat_options.includes(m)) return fail("El tipo de carne no es válido");
      } else if (has("meat_choice")) return fail("Este producto no admite elección de carne");
      if (Array.isArray(cfg.side_options) && cfg.side_options.length) {
        const s = String(custom.side_choice || "");
        if (cfg.side_required && !cfg.side_options.includes(s)) return fail("El acompañamiento no es válido");
        if (s && !cfg.side_options.includes(s)) return fail("El acompañamiento no es válido");
      } else if (has("side_choice")) return fail("Este producto no admite acompañamiento");
      if (Array.isArray(cfg.sauce_choice_options) && cfg.sauce_choice_options.length) {
        const s = String(custom.sauce_choice || "");
        if (s && !cfg.sauce_choice_options.includes(s)) return fail("La salsa elegida no es válida");
      } else if (has("sauce_choice")) return fail("Este producto no admite elección de salsa");
      if (Array.isArray(cfg.extra_sauce_options) && cfg.extra_sauce_options.length) {
        const es = cleanList(custom.extra_sauces, cfg.extra_sauce_options.length, "salsas");
        if (es.some((x) => !cfg.extra_sauce_options.includes(x))) return fail("Una salsa extra no está disponible");
        unitPrice += es.length * Number(cfg.extra_sauce_price || 0);
      } else if (has("extra_sauces")) return fail("Este producto no admite salsas extra");
      if (cfg.allow_extra_ingredients) {
        const ei = cleanList(custom.extra_ingredients, 5, "ingredientes extra");
        unitPrice += ei.length * Number(cfg.extra_ingredient_price || 0);
      } else if (has("extra_ingredients")) return fail("Este producto no admite ingredientes extra");
      if (cfg.allow_removals) cleanList(custom.remove_ingredients, 5, "ingredientes a quitar");
      else if (has("remove_ingredients")) return fail("Este producto no admite cambios de ingredientes");
      const extraCheese = custom.extra_cheese === true;
      if (extraCheese && !Number.isFinite(Number(cfg.extra_cheese_price))) return fail("El queso extra no está disponible");
      if (has("extra_cheese") && typeof custom.extra_cheese !== "boolean") return fail("La opción de queso no es válida");
      if (extraCheese) unitPrice += Number(cfg.extra_cheese_price);
      const onlyMeat = /solo carne/i.test(product.name);
      if (has("only_meat") && Boolean(custom.only_meat) !== onlyMeat) return fail("La opción solo carne no es válida");
      if (cfg.bundle_count) {
        if (!Array.isArray(custom.unit_choices) || custom.unit_choices.length !== Number(cfg.bundle_count)) return fail("Elige cada unidad de la oferta");
        const uc = custom.unit_choices.map((x) => ({ style: String(x?.style || ""), meat: String(x?.meat || "") }));
        if (uc.some((x) => !cfg.style_options?.includes(x.style) || !cfg.meat_options?.includes(x.meat))) return fail("Una elección de la oferta no es válida");
      } else if (has("unit_choices")) return fail("Este producto no admite elección de unidades");
      if (cfg.pizza_count) {
        const pf = cleanList(custom.pizza_flavors, Number(cfg.pizza_count), "sabores");
        if (pf.length !== Number(cfg.pizza_count) || pf.some((x) => !cfg.pizza_flavor_options?.includes(x))) return fail("Elige sabores válidos para la oferta");
      } else if (has("pizza_flavors")) return fail("Este producto no admite elección de pizzas");
      if (cfg.drink_count) {
        const dc = cleanList(custom.drink_choices, Number(cfg.drink_count), "bebidas");
        if (dc.length !== Number(cfg.drink_count) || dc.some((x) => !activeDrinks.has(x))) return fail("Elige bebidas válidas para la oferta");
        for (const x of dc) unitPrice += drinkExtra(cfg, x);
      } else if (has("drink_choices")) return fail("Este producto no admite elección de bebidas");
      const fixedDrink = String(cfg.fixed_drink || "");
      if (fixedDrink && !activeDrinks.has(fixedDrink)) return fail("La bebida incluida no está disponible");
      if (has("fixed_drink") && String(custom.fixed_drink || "") !== fixedDrink) return fail("La bebida fija de la oferta no es válida");
      unitPrice = Math.round(unitPrice * 100) / 100;
      const lineTotal = Math.round(unitPrice * qty * 100) / 100;
      subtotal += lineTotal;
      lines.push({ product_id: product.id, product_name: product.name, unit_price: unitPrice, quantity: qty, line_total: lineTotal, customizations: custom });
    }
  } catch (e) {
    if (e instanceof InvalidCustomization) return [400, { ok: false, error: e.message }];
    throw e;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const fee = fulfilment === "delivery" ? zoneFees[zone] : 0;
  const minimum = fulfilment === "delivery" && zone === "sant_llorenc_savall" ? 50 : fulfilment === "delivery" ? 10 : 0;
  if (subtotal < minimum) return [400, { ok: false, error: zone === "sant_llorenc_savall" ? "Sant Llorenç de Savall requiere un mínimo de 50 € en productos, más 10 € de reparto." : "El mínimo para reparto es 10 € en productos." }];
  const total = Math.round((subtotal + fee) * 100) / 100;
  return [200, { ok: true, total, subtotal, fee, lines }];
}

module.exports = { createOrder, zoneFees };
