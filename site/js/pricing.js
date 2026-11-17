/*
 * Tele Kebab Pizzería · Motor de carta, precios y reparto (compartido).
 *
 * Replica EXACTAMENTE las reglas que valida el servidor (Edge Function `create-order`).
 * El servidor es siempre quien fija el precio final; este módulo sólo muestra al cliente
 * el mismo importe que cobrará el restaurante. Se ejecuta en el navegador (window.TKPricing)
 * y en Node para las pruebas automáticas (module.exports).
 */
(function (root) {
  "use strict";

  var DRINK_FAMILIES = ["Bebidas", "Otras bebidas", "Cervezas y vinos"];

  /* ---------- Datos comerciales (valores reales del negocio) ---------- */
  var BUSINESS = {
    name: "Tele Kebab Pizzería",
    town: "Castellar del Vallès",
    address: "Carretera de Sentmenat 68–72, local 4",
    postalTown: "08211 Castellar del Vallès, Barcelona",
    phone: "937 47 46 96",
    phoneIntl: "+34937474696",
    // Horario indicado por el propietario: todos los días, turno de mediodía y de noche.
    hours: [
      { from: "11:30", to: "16:00" },
      { from: "18:00", to: "23:00" }
    ],
    timeZone: "Europe/Madrid",
    payments: [
      { value: "Efectivo", label: "Efectivo", hint: "Pagas al recibir o al recoger" },
      { value: "Tarjeta física en TPV", label: "Tarjeta", hint: "Datáfono al recibir o al recoger" }
    ]
  };

  // Zonas que acepta el servidor (orders.zone). Las tarifas coinciden con create-order.
  var ZONES = [
    { id: "castellar", name: "Castellar del Vallès", fee: 1.5, minimum: 10, group: "Castellar del Vallès" },
    { id: "sentmenat", name: "Sentmenat pueblo", fee: 3, minimum: 10, group: "Alrededores" },
    { id: "airesol_ab", name: "Airesol A/B", fee: 3, minimum: 10, group: "Alrededores" },
    { id: "airesol_d", name: "Airesol D", fee: 3, minimum: 10, group: "Alrededores" },
    { id: "sant_feliu", name: "Sant Feliu del Racó", fee: 3, minimum: 10, group: "Alrededores" },
    { id: "sant_llorenc_savall", name: "Sant Llorenç Savall", fee: 10, minimum: 50, group: "Sant Llorenç Savall" }
  ];

  var TABLES = ["S1", "S2", "S3", "S4", "T1", "T2", "T3", "T4"];

  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  function zoneById(id) {
    for (var i = 0; i < ZONES.length; i++) if (ZONES[i].id === id) return ZONES[i];
    return null;
  }

  function deliveryFee(fulfilment, zoneId) {
    if (fulfilment !== "delivery") return 0;
    var z = zoneById(zoneId);
    return z ? z.fee : 0;
  }

  function minimumOrder(fulfilment, zoneId) {
    if (fulfilment !== "delivery") return 0;
    var z = zoneById(zoneId);
    return z ? z.minimum : 10;
  }

  /* ---------- Horario ---------- */
  function toMinutes(hhmm) {
    var p = String(hhmm).split(":");
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }

  function madridMinutes(date) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date || new Date());
    var h = 0, m = 0;
    parts.forEach(function (p) { if (p.type === "hour") h = Number(p.value); if (p.type === "minute") m = Number(p.value); });
    return h * 60 + m;
  }

  function openState(date, hours) {
    var list = hours || BUSINESS.hours;
    var t = madridMinutes(date);
    for (var i = 0; i < list.length; i++) {
      var a = toMinutes(list[i].from), b = toMinutes(list[i].to);
      if (t >= a && t < b) return { open: true, closesAt: list[i].to, minutesLeft: b - t };
    }
    var next = null;
    for (var j = 0; j < list.length; j++) {
      if (toMinutes(list[j].from) > t) { next = list[j].from; break; }
    }
    return { open: false, opensAt: next || list[0].from, tomorrow: !next };
  }

  /* ---------- Bebidas ---------- */
  function isDrink(p) { return p && DRINK_FAMILIES.indexOf(p.family) >= 0; }

  function drinkExtra(cfg, name, menu) {
    if (!name) return 0;
    if (Array.isArray(cfg.drink_options) && cfg.drink_options.indexOf(name) >= 0) return 0;
    var d = null;
    for (var i = 0; i < menu.length; i++) if (menu[i].name === name && isDrink(menu[i])) { d = menu[i]; break; }
    if (!d) return 0;
    var base = Number(cfg.drink_base_price != null ? cfg.drink_base_price : 2.2);
    return Math.max(0, round2(Number(d.price) - base));
  }

  function drinkChoices(cfg, menu) {
    var drinks = menu.filter(isDrink);
    var included = (Array.isArray(cfg.drink_options) && cfg.drink_options.length
      ? cfg.drink_options
      : drinks.filter(function (x) { return x.family === "Bebidas"; }).map(function (x) { return x.name; })
    ).filter(function (n) { return drinks.some(function (x) { return x.name === n; }); });
    var more = drinks.filter(function (x) { return included.indexOf(x.name) < 0; });
    return included.map(function (n) { return { value: n, extra: 0 }; })
      .concat(more.map(function (x) { return { value: x.name, extra: drinkExtra(cfg, x.name, menu) }; }));
  }

  /* ---------- Ingredientes (quitar / añadir) ---------- */
  var ING_BASE_PIZZA = ["Tomate", "Mozzarella", "Orégano"];
  var ING_PIZZA = {
    "margarita": [], "jamón dulce": ["Jamón dulce"], "jamon dulce": ["Jamón dulce"], "fungi": ["Champiñones"],
    "tropical": ["Jamón dulce", "Piña"], "atún": ["Atún", "Cebolla"], "atun": ["Atún", "Cebolla"],
    "cuatro estaciones": ["Jamón dulce", "Champiñones", "Alcachofa", "Aceitunas"],
    "vegetal": ["Pimiento", "Cebolla", "Champiñones", "Aceitunas", "Maíz"], "cuatro quesos": [],
    "kebab": ["Carne de kebab", "Cebolla"], "barbacoa": ["Pollo", "Bacon", "Salsa barbacoa"],
    "tikka boti": ["Pollo tikka", "Cebolla", "Pimiento"], "tikka boti picada": ["Pollo tikka", "Cebolla", "Pimiento"],
    "jamón": ["Jamón dulce"], "jamon": ["Jamón dulce"]
  };
  var EXTRAS_DEFAULT = ["Jamón dulce", "Champiñones", "Atún", "Pollo", "Carne de kebab", "Bacon", "Piña", "Cebolla", "Pimiento", "Aceitunas", "Maíz"];

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function removableFor(p) {
    var c = p.customization_config || {};
    if (Array.isArray(c.ingredients) && c.ingredients.length) return c.ingredients.slice();
    var n = String(p.name || "").toLowerCase().trim(), t = c.type || "";
    if (/solo carne/.test(n)) return [];
    if (/lahmacun/.test(n)) return ["Cebolla", "Perejil", "Lechuga", "Tomate"];
    if (t === "pizza" || t === "pizza_custom" || /calzone|pizza/.test(n)) {
      var k = n.replace(/^calzone\s+/, "");
      return uniq((ING_PIZZA[k] || []).concat(ING_BASE_PIZZA));
    }
    if (t === "taco" || /taco/.test(n)) return ["Queso", "Patatas dentro", "Lechuga", "Tomate", "Cebolla"];
    if (/falafel/.test(n)) return ["Lechuga", "Tomate", "Cebolla", "Zanahoria", "Salsa"];
    if (t === "wrap" || /kebab|d[uü]r[uü]m|pita/.test(n)) return ["Lechuga", "Tomate", "Cebolla", "Zanahoria", "Col lombarda", "Salsa"];
    if (/ensalada/.test(n)) return ["Cebolla", "Tomate", "Maíz", "Atún", "Aceitunas", "Huevo"];
    if (/plato|gratinado|arroz/.test(n)) return ["Ensalada", "Cebolla", "Tomate", "Salsa"];
    return [];
  }

  function extrasFor(p) {
    var c = p.customization_config || {};
    if (Array.isArray(c.extra_ingredient_options) && c.extra_ingredient_options.length) return c.extra_ingredient_options.slice();
    return EXTRAS_DEFAULT.slice();
  }

  /* ---------- Producto ---------- */
  function needsCustomization(p) {
    var c = p.customization_config || {};
    return !!(c.size_required || c.drink_required || (c.meat_options && c.meat_options.length) ||
      (c.side_options && c.side_options.length) || (c.sauce_choice_options && c.sauce_choice_options.length) ||
      (c.extra_sauce_options && c.extra_sauce_options.length) || c.allow_removals || c.allow_extra_ingredients ||
      c.extra_cheese_price || c.bundle_count || c.pizza_count);
  }

  // Precio "desde" que se muestra en la carta (el más bajo posible).
  function fromPrice(p) {
    var c = p.customization_config || {};
    if (c.size_required && Array.isArray(c.sizes) && c.sizes.length) {
      return Math.min.apply(null, c.sizes.map(function (s) { return Number(s.price); }));
    }
    return Number(p.price);
  }

  function hasVariablePrice(p) {
    var c = p.customization_config || {};
    return !!(c.size_required && Array.isArray(c.sizes) && c.sizes.length > 1);
  }

  // Precio unitario de una línea configurada (idéntico al cálculo del servidor).
  function unitPrice(product, custom, menu) {
    var c = custom || {}, cfg = product.customization_config || {};
    var base = Number(product.price);
    if (cfg.size_required) {
      var size = (cfg.sizes || []).filter(function (s) { return s.name === c.size; })[0];
      if (size) base = Number(size.price);
    }
    var total = base;
    if (cfg.drink_required && c.menu_drink) total += drinkExtra(cfg, c.menu_drink, menu);
    if (Array.isArray(cfg.extra_sauce_options) && cfg.extra_sauce_options.length) total += (c.extra_sauces || []).length * Number(cfg.extra_sauce_price || 0);
    if (cfg.allow_extra_ingredients) total += (c.extra_ingredients || []).length * Number(cfg.extra_ingredient_price || 0);
    if (c.extra_cheese === true) total += Number(cfg.extra_cheese_price || 0);
    if (cfg.drink_count) (c.drink_choices || []).forEach(function (d) { total += drinkExtra(cfg, d, menu); });
    return round2(total);
  }

  // Valida la personalización con las mismas reglas que el servidor. Devuelve "" si es válida.
  function validate(product, custom, menu) {
    var c = custom || {}, cfg = product.customization_config || {};
    var drinks = menu.filter(function (x) { return isDrink(x) && x.active !== false; }).map(function (x) { return x.name; });
    if (cfg.size_required && !(cfg.sizes || []).some(function (s) { return s.name === c.size; })) return "Elige el tamaño.";
    if (cfg.drink_required && drinks.indexOf(c.menu_drink) < 0) return "Elige la bebida del menú.";
    if (cfg.meat_options && cfg.meat_options.length) {
      if (cfg.meat_required && cfg.meat_options.indexOf(c.meat_choice) < 0) return "Elige el tipo de carne.";
    }
    if (cfg.side_options && cfg.side_options.length) {
      if (cfg.side_required && cfg.side_options.indexOf(c.side_choice) < 0) return "Elige el acompañamiento.";
    }
    if ((c.extra_ingredients || []).length > 5) return "Máximo 5 ingredientes extra.";
    if ((c.remove_ingredients || []).length > 5) return "Puedes quitar hasta 5 ingredientes.";
    if (cfg.bundle_count) {
      var u = c.unit_choices || [];
      if (u.length !== Number(cfg.bundle_count) || u.some(function (x) { return (cfg.style_options || []).indexOf(x.style) < 0 || (cfg.meat_options || []).indexOf(x.meat) < 0; })) return "Elige el formato y la carne de cada unidad.";
    }
    if (cfg.pizza_count) {
      var f = c.pizza_flavors || [];
      if (f.length !== Number(cfg.pizza_count) || f.some(function (x) { return (cfg.pizza_flavor_options || []).indexOf(x) < 0; })) return "Elige el sabor de cada pizza.";
    }
    if (cfg.drink_count) {
      var d = c.drink_choices || [];
      if (d.length !== Number(cfg.drink_count) || d.some(function (x) { return drinks.indexOf(x) < 0; })) return "Elige todas las bebidas incluidas.";
    }
    return "";
  }

  // Normaliza la personalización a las claves exactas que acepta el servidor.
  function cleanCustom(product, raw) {
    var r = raw || {}, cfg = product.customization_config || {}, out = {};
    var list = function (v) { return uniq((Array.isArray(v) ? v : []).map(function (x) { return String(x).trim(); }).filter(Boolean)); };
    if (cfg.size_required && r.size) out.size = r.size;
    if (cfg.drink_required && r.menu_drink) out.menu_drink = r.menu_drink;
    if (cfg.meat_options && cfg.meat_options.length && r.meat_choice) out.meat_choice = r.meat_choice;
    if (cfg.side_options && cfg.side_options.length && r.side_choice) out.side_choice = r.side_choice;
    if (cfg.sauce_choice_options && cfg.sauce_choice_options.length && r.sauce_choice) out.sauce_choice = r.sauce_choice;
    if (cfg.extra_sauce_options && cfg.extra_sauce_options.length && list(r.extra_sauces).length) out.extra_sauces = list(r.extra_sauces);
    if (cfg.allow_extra_ingredients && list(r.extra_ingredients).length) out.extra_ingredients = list(r.extra_ingredients).slice(0, 5);
    if (cfg.allow_removals && list(r.remove_ingredients).length) out.remove_ingredients = list(r.remove_ingredients).slice(0, 5);
    if (Number.isFinite(Number(cfg.extra_cheese_price)) && cfg.extra_cheese_price != null && r.extra_cheese === true) out.extra_cheese = true;
    if (/solo carne/i.test(product.name)) out.only_meat = true;
    if (cfg.bundle_count && Array.isArray(r.unit_choices)) out.unit_choices = r.unit_choices.map(function (u) { return { style: String(u.style || ""), meat: String(u.meat || "") }; });
    if (cfg.pizza_count && Array.isArray(r.pizza_flavors)) out.pizza_flavors = r.pizza_flavors.slice();
    if (cfg.drink_count && Array.isArray(r.drink_choices)) out.drink_choices = r.drink_choices.slice();
    if (cfg.fixed_drink) out.fixed_drink = cfg.fixed_drink;
    out.notes = String(r.notes || "").trim().slice(0, 180);
    return out;
  }

  function describe(c) {
    var a = [];
    if (!c) return a;
    if (c.size) a.push(c.size);
    if (c.meat_choice) a.push("Carne: " + c.meat_choice);
    if (c.only_meat) a.push("Solo carne");
    if (c.side_choice) a.push("Con " + c.side_choice.toLowerCase());
    if (c.sauce_choice) a.push(c.sauce_choice);
    if (c.menu_drink) a.push("Bebida: " + c.menu_drink);
    if (c.extra_sauces && c.extra_sauces.length) a.push("+ " + c.extra_sauces.join(", "));
    if (c.extra_ingredients && c.extra_ingredients.length) a.push("+ " + c.extra_ingredients.join(", "));
    if (c.extra_cheese) a.push("+ Queso extra");
    if (c.remove_ingredients && c.remove_ingredients.length) a.push("Sin " + c.remove_ingredients.join(", ").toLowerCase());
    if (c.unit_choices && c.unit_choices.length) a.push(c.unit_choices.map(function (u) { return u.style + " (" + u.meat.toLowerCase() + ")"; }).join(" · "));
    if (c.pizza_flavors && c.pizza_flavors.length) a.push("Pizzas: " + c.pizza_flavors.join(", "));
    if (c.drink_choices && c.drink_choices.length) a.push("Bebidas: " + c.drink_choices.join(", "));
    if (c.fixed_drink) a.push("Incluye " + c.fixed_drink);
    if (c.notes) a.push("«" + c.notes + "»");
    return a;
  }

  /* ---------- Totales del carrito ---------- */
  function totals(lines, fulfilment, zoneId, menu) {
    var subtotal = 0;
    lines.forEach(function (l) { subtotal += round2(unitPrice(l.product, l.customizations, menu) * l.quantity); });
    subtotal = round2(subtotal);
    var fee = deliveryFee(fulfilment, zoneId);
    var minimum = minimumOrder(fulfilment, zoneId);
    return { subtotal: subtotal, fee: fee, total: round2(subtotal + fee), minimum: minimum, missing: Math.max(0, round2(minimum - subtotal)) };
  }

  var api = {
    BUSINESS: BUSINESS, ZONES: ZONES, TABLES: TABLES, DRINK_FAMILIES: DRINK_FAMILIES,
    round2: round2, zoneById: zoneById, deliveryFee: deliveryFee, minimumOrder: minimumOrder,
    openState: openState, madridMinutes: madridMinutes, toMinutes: toMinutes,
    isDrink: isDrink, drinkExtra: drinkExtra, drinkChoices: drinkChoices,
    removableFor: removableFor, extrasFor: extrasFor, needsCustomization: needsCustomization,
    fromPrice: fromPrice, hasVariablePrice: hasVariablePrice, unitPrice: unitPrice,
    validate: validate, cleanCustom: cleanCustom, describe: describe, totals: totals
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TKPricing = api;
})(typeof window !== "undefined" ? window : globalThis);
