/*
 * Tele Kebab · Asistente del negocio (local, sin coste, sin terceros).
 * Todas las conclusiones salen de pedidos y productos reales. Si no hay datos
 * suficientes, se dice explícitamente: nunca se inventan cifras.
 */
(function (root) {
  "use strict";
  var TZ = "Europe/Madrid";
  var DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  var MIN_ORDERS = 5;

  function r2(n) { return Math.round(n * 100) / 100; }
  function parts(iso) {
    var p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    var wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday];
    return { day: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour), weekday: wd };
  }
  function valid(orders) { return (orders || []).filter(function (o) { return o.status !== "cancelado"; }); }
  function madridDay(d) { return parts((d || new Date()).toISOString()).day; }
  function addDays(day, n) { var d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function weekStart(day) { var d = new Date(day + "T12:00:00Z"); var wd = (d.getUTCDay() + 6) % 7; return addDays(day, -wd); }

  /* KPIs del panel: hoy, semana (lunes a hoy), mes natural. */
  function kpis(orders, now) {
    var today = madridDay(now), ws = weekStart(today), ms = today.slice(0, 8) + "01";
    var res = { today: { n: 0, sales: 0 }, week: { n: 0, sales: 0 }, month: { n: 0, sales: 0 }, cancelledToday: 0 };
    (orders || []).forEach(function (o) {
      var d = parts(o.created_at).day;
      if (o.status === "cancelado") { if (d === today) res.cancelledToday++; return; }
      var t = Number(o.total || 0);
      if (d === today) { res.today.n++; res.today.sales += t; }
      if (d >= ws && d <= today) { res.week.n++; res.week.sales += t; }
      if (d >= ms && d <= today) { res.month.n++; res.month.sales += t; }
    });
    ["today", "week", "month"].forEach(function (k) { res[k].sales = r2(res[k].sales); res[k].avg = res[k].n ? r2(res[k].sales / res[k].n) : 0; });
    return res;
  }

  function daily(orders, days, now) {
    var today = madridDay(now), map = {}, out = [];
    valid(orders).forEach(function (o) { var d = parts(o.created_at).day; map[d] = (map[d] || 0) + Number(o.total || 0); });
    for (var i = days - 1; i >= 0; i--) { var d = addDays(today, -i); out.push({ day: d, sales: r2(map[d] || 0) }); }
    return out;
  }

  function topProducts(orders, limit) {
    var c = {};
    valid(orders).forEach(function (o) { (o.order_items || []).forEach(function (i) { var n = i.product_name || "Producto"; c[n] = c[n] || { name: n, qty: 0, revenue: 0 }; c[n].qty += Number(i.quantity || 0); c[n].revenue += Number(i.line_total || 0); }); });
    return Object.keys(c).map(function (k) { c[k].revenue = r2(c[k].revenue); return c[k]; }).sort(function (a, b) { return b.qty - a.qty || b.revenue - a.revenue; }).slice(0, limit || 10);
  }

  function salesSummary(orders, rangeDays) {
    var v = valid(orders), all = orders || [];
    if (v.length < MIN_ORDERS) return { enough: false, n: v.length, text: ["Todavía hay " + v.length + " pedidos válidos en este periodo. Con al menos " + MIN_ORDERS + " el asistente puede sacar conclusiones fiables."] };
    var total = v.reduce(function (a, o) { return a + Number(o.total || 0); }, 0);
    var byF = {}; v.forEach(function (o) { byF[o.fulfilment] = (byF[o.fulfilment] || 0) + 1; });
    var cancel = all.length - v.length;
    var fees = v.reduce(function (a, o) { return a + Number(o.delivery_fee || 0); }, 0);
    var lines = [];
    lines.push("<b>" + v.length + " pedidos</b> válidos en los últimos " + rangeDays + " días, con unas ventas de <b>" + money(total) + "</b> (ticket medio " + money(total / v.length) + ").");
    var fl = { delivery: "a domicilio", pickup: "para recoger", dine_in: "en el local" };
    lines.push("Reparto de pedidos: " + Object.keys(byF).map(function (k) { return pct(byF[k], v.length) + " " + (fl[k] || k); }).join(", ") + ".");
    if (fees) lines.push("Gastos de envío cobrados: " + money(fees) + ".");
    if (cancel) lines.push("Pedidos cancelados: <b>" + cancel + "</b> (" + pct(cancel, all.length) + " del total). " + (cancel / all.length > 0.15 ? "Es una tasa alta: revisa los motivos de cancelación en el tablero de cocina." : ""));
    var top = topProducts(v, 3);
    if (top.length) lines.push("Lo que más se pide: " + top.map(function (t) { return "<b>" + esc(t.name) + "</b> (" + t.qty + ")"; }).join(", ") + ".");
    return { enough: true, n: v.length, text: lines };
  }

  function timing(orders) {
    var v = valid(orders), grid = [], byDay = [0, 0, 0, 0, 0, 0, 0], byHour = {};
    for (var d = 0; d < 7; d++) { grid.push({}); }
    v.forEach(function (o) { var p = parts(o.created_at); byDay[p.weekday]++; byHour[p.hour] = (byHour[p.hour] || 0) + 1; grid[p.weekday][p.hour] = (grid[p.weekday][p.hour] || 0) + 1; });
    if (v.length < MIN_ORDERS) return { enough: false, grid: grid, text: ["Aún no hay suficientes pedidos para detectar las horas fuertes."] };
    var bestDay = byDay.indexOf(Math.max.apply(null, byDay));
    var hours = Object.keys(byHour).sort(function (a, b) { return byHour[b] - byHour[a]; });
    var lines = ["El día con más pedidos es el <b>" + DAYS[bestDay] + "</b> (" + byDay[bestDay] + " pedidos).",
      "Franja más fuerte: <b>" + hours[0] + ":00–" + (Number(hours[0]) + 1) + ":00</b>" + (hours[1] ? ", seguida de " + hours[1] + ":00–" + (Number(hours[1]) + 1) + ":00" : "") + ". Asegura personal y masa preparada antes de esa hora."];
    var quiet = byDay.indexOf(Math.min.apply(null, byDay));
    if (byDay[quiet] < byDay[bestDay] / 2) lines.push("El <b>" + DAYS[quiet] + "</b> es el día más flojo: buen candidato para una promoción.");
    return { enough: true, grid: grid, byDay: byDay, text: lines };
  }

  // Pares de productos que aparecen juntos en el mismo pedido (análisis de cesta).
  function pairs(orders, limit) {
    var v = valid(orders), count = {}, single = {};
    v.forEach(function (o) {
      var names = []; (o.order_items || []).forEach(function (i) { if (names.indexOf(i.product_name) < 0) names.push(i.product_name); });
      names.forEach(function (n) { single[n] = (single[n] || 0) + 1; });
      names.sort();
      for (var a = 0; a < names.length; a++) for (var b = a + 1; b < names.length; b++) { var k = names[a] + "||" + names[b]; count[k] = (count[k] || 0) + 1; }
    });
    var res = Object.keys(count).filter(function (k) { return count[k] >= 2; }).map(function (k) {
      var p = k.split("||"); return { a: p[0], b: p[1], n: count[k], share: count[k] / Math.min(single[p[0]], single[p[1]]) };
    }).sort(function (x, y) { return y.n - x.n || y.share - x.share; }).slice(0, limit || 6);
    return { enough: v.length >= MIN_ORDERS, pairs: res };
  }

  function promoIdeas(pairList, products) {
    var price = {}; (products || []).forEach(function (p) { price[p.name] = Number(p.price); });
    return pairList.map(function (p) {
      var sum = (price[p.a] || 0) + (price[p.b] || 0);
      var idea = sum ? "Combo «" + p.a + " + " + p.b + "»: hoy suman " + money(sum) + " por separado. Un precio cerrado redondo puede subir el ticket medio." : "Considera un combo con ambos productos.";
      return { text: "<b>" + esc(p.a) + "</b> y <b>" + esc(p.b) + "</b> aparecen juntos en " + p.n + " pedidos.", idea: esc(idea) };
    });
  }

  // Revisión de la carta: detecta datos incompletos o incoherentes (no cambia nada).
  function audit(products, sold30) {
    var out = [], ps = products || [];
    var noDesc = ps.filter(function (p) { return p.active && !String(p.description || "").trim(); });
    if (noDesc.length) out.push({ tag: "Descripción", text: noDesc.length + " productos visibles sin descripción (p. ej. " + noDesc.slice(0, 3).map(function (p) { return esc(p.name); }).join(", ") + "). Usa «Sugerir descripción» al editarlos." });
    var lower = ps.filter(function (p) { return /^[a-záéíóúñü]/.test(String(p.name || "")); });
    if (lower.length) out.push({ tag: "Nombres", text: "Nombres que empiezan en minúscula: " + lower.map(function (p) { return esc(p.name); }).join(", ") + "." });
    ps.forEach(function (p) {
      var c = p.customization_config || {};
      if (c.size_required && Array.isArray(c.sizes) && c.sizes.length) {
        var min = Math.min.apply(null, c.sizes.map(function (s) { return Number(s.price); }));
        var max = Math.max.apply(null, c.sizes.map(function (s) { return Number(s.price); }));
        if (Number(p.price) !== min && Number(p.price) !== max) out.push({ tag: "Precio", text: "<b>" + esc(p.name) + "</b>: precio base " + money(p.price) + " no coincide con ningún tamaño (" + c.sizes.map(function (s) { return esc(s.name) + " " + money(s.price); }).join(", ") + "). El cliente paga el del tamaño." });
      }
      if (c.drink_count && /\+\s*1\s*bebida/i.test(p.name) && Number(c.drink_count) !== 1) out.push({ tag: "Coherencia", text: "<b>" + esc(p.name) + "</b>: el nombre dice 1 bebida pero la oferta pide elegir " + c.drink_count + "." });
      if (p.source_status && p.source_status !== "legacy" && p.active) out.push({ tag: "Pendiente", text: "<b>" + esc(p.name) + "</b> está marcado como «" + esc(p.source_status) + "»" + (p.source_note ? ": " + esc(p.source_note) : "") + "." });
    });
    var names = {}; ps.forEach(function (p) { var k = String(p.name).trim().toLowerCase(); names[k] = (names[k] || 0) + 1; });
    Object.keys(names).filter(function (k) { return names[k] > 1; }).forEach(function (k) { out.push({ tag: "Duplicado", text: "Hay " + names[k] + " productos llamados «" + esc(k) + "»." }); });
    if (sold30) {
      var never = ps.filter(function (p) { return p.active && !sold30[p.name] && !/^(Bebidas|Otras bebidas|Salsas y extras)$/.test(p.family); });
      if (never.length && Object.keys(sold30).length >= 10) out.push({ tag: "Ventas", text: never.length + " productos visibles sin ventas en 30 días: " + never.slice(0, 6).map(function (p) { return esc(p.name); }).join(", ") + (never.length > 6 ? "…" : "") + ". Valora destacarlos o retirarlos." });
    }
    return out;
  }

  // Generador de descripciones a partir de los datos reales del producto (plantillas, revisables).
  function describeProduct(p) {
    var c = p.customization_config || {}, n = String(p.name || "").trim(), bits = [];
    var lower = n.toLowerCase();
    var base = /pizza|margarita|fungi|tropical|barbacoa|tikka|cuatro|vegetal|telespecial|jamón dulce|atún|kebab$/i.test(n) && (c.type === "pizza") ? "Pizza " + n.toLowerCase() + " horneada al momento" :
      /calzone/i.test(n) ? n + " cerrado y horneado al momento" :
      /d[uü]r[uü]m/i.test(n) ? (/men[uú]/i.test(n) ? "Menú con dürüm enrollado al momento" : "Dürüm enrollado al momento") :
      /pita/i.test(n) ? (/men[uú]/i.test(n) ? "Menú con pan de pita relleno" : "Pan de pita relleno") :
      /taco/i.test(n) ? "Taco francés gratinado" : /falafel/i.test(n) ? "Falafel crujiente" :
      /plato/i.test(n) ? n + " servido en plato" : n;
    if (/solo carne/i.test(n)) bits.push("sólo con carne");
    if (Array.isArray(c.ingredients) && c.ingredients.length) bits.push("con " + list(c.ingredients.map(function (x) { return x.toLowerCase(); })));
    if (Array.isArray(c.meat_options) && c.meat_options.length) bits.push("carne a elegir: " + list(c.meat_options.map(function (x) { return x.toLowerCase(); }), "o"));
    if (Array.isArray(c.side_options) && c.side_options.length) bits.push("acompañado de " + list(c.side_options.map(function (x) { return x.toLowerCase(); }), "o"));
    if (c.size_required && Array.isArray(c.sizes)) bits.push("en " + list(c.sizes.map(function (s) { return s.name.toLowerCase(); }), "o"));
    if (c.drink_required || c.drink_included) bits.push("incluye bebida");
    if (Array.isArray(c.sauce_choice_options) && c.sauce_choice_options.length) bits.push("salsa a tu gusto");
    if (c.bundle_count) bits.push(c.bundle_count + " unidades a elegir entre " + list((c.style_options || []).map(function (x) { return x.toLowerCase(); }), "o"));
    if (c.pizza_count) bits.push(c.pizza_count + (c.pizza_count > 1 ? " pizzas" : " pizza") + " del sabor que elijas");
    if (c.fixed_drink) bits.push("con " + c.fixed_drink);
    var txt = base + (bits.length ? ", " + bits.join(", ") : "") + ".";
    txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    return txt.length > 300 ? txt.slice(0, 297) + "…" : txt;
    void lower;
  }

  function list(a, conj) { conj = conj || "y"; return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " " + conj + " " + a[a.length - 1]; }
  function money(n) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + " %" : "0 %"; }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var api = { kpis: kpis, daily: daily, topProducts: topProducts, salesSummary: salesSummary, timing: timing, pairs: pairs, promoIdeas: promoIdeas, audit: audit, describeProduct: describeProduct, parts: parts, madridDay: madridDay, addDays: addDays, MIN_ORDERS: MIN_ORDERS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TKInsights = api;
})(typeof window !== "undefined" ? window : globalThis);
