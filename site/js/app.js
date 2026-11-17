/* Tele Kebab Pizzería · Web pública: carta, personalización, carrito, pedido y seguimiento. */
(function () {
  "use strict";
  var P = window.TKPricing;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (_) {} }
  };

  /* ---------- Estado ---------- */
  var cfg = window.TELEKEBAB_CONFIG || {};
  var client = (cfg.url && cfg.anonKey && window.supabase) ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } }) : null;
  var menu = [], menuReady = false, cart = [], activeFamily = "Todas", query = "";
  var step = 1, submitting = false, settings = { announcement: "", ordering_paused: false };
  var tableParam = (new URLSearchParams(location.search).get("mesa") || "").toUpperCase();
  var dineAllowed = P.TABLES.indexOf(tableParam) >= 0 || new URLSearchParams(location.search).has("local");

  /* ---------- Fotografías reales disponibles ---------- */
  var PHOTOS = [
    [/^oferta 4 pizzas/i, "cuatro-pizzas"], [/^oferta pizza 36/i, "pizza-36"], [/^oferta pizza 28/i, "pizza-28"], [/^oferta pizza 26/i, "pizza-26"],
    [/^oferta 2 kebab/i, "dos-durum"], [/^oferta 3 kebab/i, "tres-durum"], [/^oferta 4 kebab/i, "cuatro-durum"], [/lahmacun/i, "lahmacun"],
    [/hamburguesa doble/i, "hamburguesa-doble"], [/nuggets/i, "nuggets"], [/^plato kebab$/i, "plato-kebab"], [/^plato falafel$/i, "falafel-plato"],
    [/^plato gratinado$/i, "gratinado"], [/^plato de alitas$/i, "alitas"], [/^arroz con pollo/i, "arroz-kebab"], [/falafel/i, "falafel-durum"],
    [/taco franc[eé]s.*xl|men[uú] taco xl/i, "taco-xl"], [/taco/i, "taco-frances"], [/(d[uü]r[uü]m).*xl/i, "durum-xl"], [/d[uü]r[uü]m/i, "durum-kebab"], [/pita/i, "kebab-pita"]
  ];
  function safeImg(u) { return /^https:\/\/zifzljhewpimjjulbyqx\.supabase\.co\/storage\/v1\/object\/public\/product-images\//.test(String(u || "")) ? u : null; }
  function photoOf(p) { return (p && safeImg(p.image_url)) || photoFor(p && p.name); }
  function photoFor(name) { var n = String(name || ""); for (var i = 0; i < PHOTOS.length; i++) if (PHOTOS[i][0].test(n)) return "assets/productos/" + PHOTOS[i][1] + ".webp"; return null; }

  var FAMILY_META = {
    "Menús y ofertas": { emoji: "🔥", photo: "dos-durum", blurb: "Menús con bebida y ofertas" },
    "Kebabs": { emoji: "🌯", photo: "durum-kebab", blurb: "Dürüm, pita y platos" },
    "Pizzas": { emoji: "🍕", photo: "pizza-28", blurb: "Clásicas y especiales" },
    "Tacos": { emoji: "🌮", photo: "taco-frances", blurb: "Tacos franceses" },
    "Falafel": { emoji: "🧆", photo: "falafel-durum", blurb: "Opción vegetariana" },
    "Calzones": { emoji: "🥟", photo: null, blurb: "Pizza cerrada al horno" },
    "Hamburguesas": { emoji: "🍔", photo: "hamburguesa-doble", blurb: "Hamburguesa doble" },
    "Platos": { emoji: "🍛", photo: "plato-kebab", blurb: "Arroces y gratinados" },
    "Entrantes": { emoji: "🍟", photo: "nuggets", blurb: "Patatas, fritos y raciones" },
    "Ensaladas": { emoji: "🥗", photo: null, blurb: "Frescas" },
    "Postres": { emoji: "🍯", photo: null, blurb: "Baklava" },
    "Bebidas": { emoji: "🥤", photo: null, blurb: "Refrescos y agua" },
    "Otras bebidas": { emoji: "🧃", photo: null, blurb: "Zumos y energéticas" },
    "Cervezas y vinos": { emoji: "🍺", photo: null, blurb: "Cervezas y vinos" },
    "Salsas y extras": { emoji: "🥣", photo: null, blurb: "Salsas y queso" }
  };
  var FAMILY_ORDER = ["Menús y ofertas", "Kebabs", "Pizzas", "Tacos", "Falafel", "Calzones", "Hamburguesas", "Platos", "Entrantes", "Ensaladas", "Postres", "Bebidas", "Otras bebidas", "Cervezas y vinos", "Salsas y extras"];

  function prettyName(n) { n = String(n || "").trim(); return n ? n.charAt(0).toLocaleUpperCase("es") + n.slice(1) : n; }
  function familySort(a, b) {
    var ia = FAMILY_ORDER.indexOf(a), ib = FAMILY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "es");
  }

  /* ---------- Utilidades UI ---------- */
  var toastTimer;
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400); }
  function notice(kind, html) { return '<div class="notice ' + kind + '">' + html + "</div>"; }
  function visual(p, cls) {
    var src = photoOf(p);
    return src ? '<img src="' + src + '" alt="" loading="lazy" decoding="async" class="' + (cls || "") + '">' : '<span class="emoji" aria-hidden="true">' + esc(p.emoji || "🍽️") + "</span>";
  }
  function priceLabel(p) {
    return (P.hasVariablePrice(p) ? "<small>desde</small>" : "") + money(P.fromPrice(p));
  }
  function productDesc(p) {
    if (p.description) return p.description;
    var c = p.customization_config || {}, bits = [];
    if (c.size_required && c.sizes) bits.push(c.sizes.map(function (s) { return s.name; }).join(" o "));
    if (c.meat_options && c.meat_options.length) bits.push(c.meat_options.join(", ").toLowerCase());
    if (c.drink_required || c.drink_included) bits.push("con bebida");
    if (c.side_options && c.side_options.length) bits.push("con " + c.side_options.join(" o ").toLowerCase());
    return bits.length ? prettyName(bits.join(" · ")) + "." : "";
  }

  /* ---------- Configuración (site_settings, si existe) ---------- */
  function hoursText(h) { return h.map(function (x) { return x.from + "–" + x.to; }).join(" · "); }
  function loadSettings() {
    if (!client) return;
    client.from("site_settings").select("value").eq("key", "public").maybeSingle().then(function (r) {
      var v = r && !r.error && r.data && r.data.value; if (!v) return;
      if (Array.isArray(v.hours) && v.hours.length) {
        P.BUSINESS.hours = v.hours;
        $("#heroHours").textContent = hoursText(v.hours);
        var rows = v.hours.map(function (h, i) { return "<tr><td>" + (v.hours.length === 2 ? (i ? "Noche" : "Mediodía") : "Turno " + (i + 1)) + "</td><td>" + esc(h.from) + " – " + esc(h.to) + "</td></tr>"; }).join("");
        $(".hours-table tbody").innerHTML = rows;
      }
      settings.announcement = String(v.announcement || "");
      settings.ordering_paused = v.ordering_paused === true;
      if (settings.announcement) { var a = $("#announce"); a.textContent = settings.announcement; a.classList.remove("hidden"); }
      updateLive(); updateSums();
    }, function () {});
  }

  /* ---------- Horario en vivo ---------- */
  function updateLive() {
    var s = P.openState(new Date());
    if (settings.ordering_paused) { $("#liveDot").className = "dot closed"; $("#liveText").textContent = "Pedidos online en pausa · llámanos al 937 47 46 96"; return s; }
    $("#liveDot").className = "dot " + (s.open ? "open" : "closed");
    $("#liveText").textContent = s.open
      ? "Abierto ahora · cierra a las " + s.closesAt
      : "Cerrado ahora · abrimos " + (s.tomorrow ? "mañana " : "") + "a las " + s.opensAt;
    return s;
  }

  /* ---------- Carta ---------- */
  function loadMenu() {
    if (!client) { renderMenuError("La carta online no está disponible en este momento. Llámanos al 937 47 46 96."); return; }
    var COLS = "id,family,category,name,price,emoji,description,active,customization_config,sort_order";
    var q = function (cols) { return client.from("products").select(cols).eq("active", true).order("sort_order").order("name"); };
    q(COLS + ",image_url")
      .then(function (r) { return r.error ? q(COLS) : r; }) // columna image_url opcional (migración pendiente)
      .then(function (r) {
        if (r.error) throw r.error;
        menu = (r.data || []).map(function (p) {
          return Object.assign({}, p, { price: Number(p.price), family: p.family || "Otros", category: p.category || "Otros", customization_config: p.customization_config || {} });
        });
        menuReady = true;
        restoreCart();
        renderCats(); renderFeatured(); renderTabs(); renderMenu(); renderCart();
      })
      .catch(function (e) { console.error(e); renderMenuError("No hemos podido cargar la carta. Comprueba tu conexión o llámanos al 937 47 46 96."); });
  }
  function renderMenuError(msg) {
    menuReady = false;
    $("#menu").innerHTML = '<div class="empty">' + esc(msg) + "</div>";
    $("#featured").innerHTML = "";
    $("#cats").innerHTML = "";
  }
  function families() {
    var f = []; menu.forEach(function (p) { if (f.indexOf(p.family) < 0) f.push(p.family); });
    return f.sort(familySort);
  }
  function renderCats() {
    var fams = families().filter(function (f) { return ["Otras bebidas", "Cervezas y vinos", "Salsas y extras", "Ensaladas", "Postres"].indexOf(f) < 0; }).slice(0, 6);
    $("#cats").innerHTML = fams.map(function (f) {
      var m = FAMILY_META[f] || { emoji: "🍽️", blurb: "" };
      var n = menu.filter(function (p) { return p.family === f; }).length;
      var art = m.photo ? '<img src="assets/productos/' + m.photo + '.webp" alt="" loading="lazy" decoding="async">' : '<span aria-hidden="true">' + m.emoji + "</span>";
      return '<a class="cat reveal" href="#carta" data-family="' + esc(f) + '"><div class="cat-art">' + art + '</div><div class="cat-body"><b>' + esc(f) + "</b><span>" + esc(m.blurb || n + " productos") + "</span></div></a>";
    }).join("");
    $$("#cats .cat").forEach(function (a) { a.addEventListener("click", function () { setFamily(a.dataset.family); }); });
    observeReveal();
  }
  function renderFeatured() {
    var offers = menu.filter(function (p) { return p.family === "Menús y ofertas"; });
    // Variedad: un menú de kebab, una oferta para compartir, una de pizza y un menú de taco.
    var wanted = [/^men[uú] d[uü]r[uü]m kebab$/i, /^oferta 2 kebab/i, /^oferta pizza 28/i, /^men[uú] taco$/i];
    var picks = [];
    wanted.forEach(function (re) { var f = offers.filter(function (p) { return re.test(p.name); })[0]; if (f) picks.push(f); });
    if (picks.length < 4) picks = picks.concat(offers.filter(function (p) { return picks.indexOf(p) < 0 && photoFor(p.name); }).slice(0, 4 - picks.length));
    $("#featured").innerHTML = picks.map(function (p) { return cardHtml(p, "Oferta"); }).join("") || "";
  }
  function renderTabs() {
    var list = ["Todas"].concat(families());
    $("#tabs").innerHTML = list.map(function (f) {
      return '<button type="button" role="tab" class="tab' + (f === activeFamily ? " active" : "") + '" aria-selected="' + (f === activeFamily) + '" data-family="' + esc(f) + '">' + esc(f) + "</button>";
    }).join("");
  }
  function setFamily(f) { activeFamily = f; renderTabs(); renderMenu(); var b = $('#tabs .tab.active'); if (b && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }
  function cardHtml(p, tag) {
    var id = esc(p.id);
    return '<article class="card"><div class="card-media">' + visual(p) + (tag ? '<span class="tagline">' + esc(tag) + "</span>" : "") +
      '</div><div class="card-body"><h4>' + esc(prettyName(p.name)) + "</h4><p>" + esc(productDesc(p)) + '</p><div class="card-foot"><span class="price">' + priceLabel(p) +
      '</span><button type="button" class="add-btn" data-add="' + id + '" aria-label="Añadir ' + esc(p.name) + '"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>' +
      (P.needsCustomization(p) ? "Elegir" : "Añadir") + "</button></div></div></article>";
  }
  function normalize(s) { return String(s || "").toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function renderMenu() {
    var q = normalize(query);
    var list = menu.filter(function (p) {
      return (activeFamily === "Todas" || p.family === activeFamily) &&
        (!q || normalize(p.name + " " + p.category + " " + p.family + " " + (p.description || "")).indexOf(q) >= 0);
    });
    if (!list.length) { $("#menu").innerHTML = '<div class="empty">No encontramos productos' + (query ? " para «" + esc(query) + "»" : "") + ".</div>"; return; }
    var groups = {};
    list.forEach(function (p) { (groups[p.family] = groups[p.family] || []).push(p); });
    $("#menu").innerHTML = Object.keys(groups).sort(familySort).map(function (f) {
      return '<section class="family" aria-label="' + esc(f) + '"><div class="family-head"><h3>' + esc(f) + "</h3><span>" + groups[f].length + " productos</span></div>" +
        '<div class="grid">' + groups[f].map(function (p) { return cardHtml(p); }).join("") + "</div></section>";
    }).join("");
  }

  /* ---------- Modal de producto (personalización) ---------- */
  var pm = { product: null, qty: 1, state: {} , editIndex: -1 };
  function choiceBtns(group, values, opts) {
    opts = opts || {};
    return '<div class="choices" data-group="' + group + '"' + (opts.multi ? ' data-multi="' + (opts.max || 99) + '"' : "") + ">" +
      values.map(function (v) {
        var val = typeof v === "object" ? v.value : v, extra = typeof v === "object" ? v.extra : 0;
        return '<button type="button" class="choice' + (opts.remove ? " remove" : "") + '" aria-pressed="false" data-v="' + esc(val) + '">' + esc(val) +
          (extra ? " <small>+" + money(extra) + "</small>" : (opts.price ? " <small>+" + money(opts.price) + "</small>" : "")) + "</button>";
      }).join("") + "</div>";
  }
  function selectHtml(id, values, placeholder) {
    return '<select class="input" data-sel="' + id + '"><option value="">' + esc(placeholder) + "</option>" +
      values.map(function (v) { var val = typeof v === "object" ? v.value : v, extra = typeof v === "object" ? v.extra : 0; return '<option value="' + esc(val) + '">' + esc(val) + (extra ? " (+" + money(extra) + ")" : "") + "</option>"; }).join("") + "</select>";
  }
  function group(title, req, body) {
    return '<div class="opt-group"><div class="opt-head"><b>' + esc(title) + "</b>" + (req ? '<span class="req need">Obligatorio</span>' : '<span class="req">Opcional</span>') + "</div>" + body + "</div>";
  }
  function openProduct(p, existing, editIndex) {
    if (!p) return;
    var c = p.customization_config || {};
    pm.product = p; pm.qty = existing ? existing.quantity : 1; pm.editIndex = editIndex == null ? -1 : editIndex;
    var src = photoOf(p);
    $("#pmHero").innerHTML = (src ? '<img src="' + src + '" alt="">' : '<span aria-hidden="true">' + esc(p.emoji || "🍽️") + "</span>") + $("#pmHero").querySelector("[data-close-modal]").outerHTML;
    $("#pmTitle").textContent = prettyName(p.name);
    $("#pmDesc").textContent = productDesc(p);
    var h = [];
    if (c.size_required && c.sizes) h.push(group("Tamaño", true, choiceBtns("size", c.sizes.map(function (s) { return { value: s.name, extra: 0 }; }))));
    if (c.meat_options && c.meat_options.length && !c.bundle_count) h.push(group("Carne", !!c.meat_required, choiceBtns("meat_choice", c.meat_options)));
    if (c.side_options && c.side_options.length) h.push(group("Acompañamiento", !!c.side_required, choiceBtns("side_choice", c.side_options)));
    if (c.sauce_choice_options && c.sauce_choice_options.length) h.push(group("Salsa", false, choiceBtns("sauce_choice", c.sauce_choice_options)));
    if (c.drink_required) h.push(group("Bebida del menú", true, '<p class="muted" style="margin:-4px 0 10px;font-size:.85rem">Las bebidas pequeñas van incluidas; otras pagan la diferencia.</p>' + selectHtml("menu_drink", P.drinkChoices(c, menu), "Elige tu bebida…")));
    if (c.bundle_count) {
      var units = "";
      for (var i = 0; i < c.bundle_count; i++) units += '<div class="unit"><span>Unidad ' + (i + 1) + "</span>" + selectHtml("unit_style_" + i, c.style_options || [], "Formato…") + selectHtml("unit_meat_" + i, c.meat_options || [], "Carne…") + "</div>";
      h.push(group("Elige cada unidad", true, units + (c.fixed_drink ? '<p class="muted" style="font-size:.85rem">Incluye ' + esc(c.fixed_drink) + ".</p>" : "")));
    }
    if (c.pizza_count) {
      var pz = "";
      for (var j = 0; j < c.pizza_count; j++) pz += '<div class="field">' + selectHtml("pizza_" + j, c.pizza_flavor_options || [], "Pizza " + (j + 1) + "…") + "</div>";
      h.push(group(c.pizza_count > 1 ? "Elige las pizzas" : "Elige tu pizza", true, pz + (c.fixed_drink ? '<p class="muted" style="font-size:.85rem">Incluye ' + esc(c.fixed_drink) + ".</p>" : "")));
    }
    if (c.drink_count) {
      var dr = "";
      for (var k = 0; k < c.drink_count; k++) dr += '<div class="field">' + selectHtml("bdrink_" + k, P.drinkChoices(c, menu), "Bebida " + (k + 1) + "…") + "</div>";
      h.push(group("Bebidas incluidas", true, dr));
    }
    if (c.extra_sauce_options && c.extra_sauce_options.length) h.push(group("Salsas extra", false, choiceBtns("extra_sauces", c.extra_sauce_options, { multi: true, price: Number(c.extra_sauce_price || 0) })));
    if (c.allow_extra_ingredients) h.push(group("Añadir ingredientes · máx. 5", false, choiceBtns("extra_ingredients", P.extrasFor(p), { multi: true, max: 5, price: Number(c.extra_ingredient_price || 0) })));
    if (c.extra_cheese_price != null && Number.isFinite(Number(c.extra_cheese_price))) h.push(group("Queso", false, '<div class="choices" data-group="extra_cheese" data-multi="1"><button type="button" class="choice" aria-pressed="false" data-v="1">Queso extra <small>+' + money(c.extra_cheese_price) + "</small></button></div>"));
    if (c.allow_removals) { var rem = P.removableFor(p); if (rem.length) h.push(group("Quitar ingredientes · sin coste", false, choiceBtns("remove_ingredients", rem, { multi: true, max: 5, remove: true }))); }
    $("#pmOptions").innerHTML = h.join("");
    $("#pmNotes").value = existing ? (existing.customizations.notes || "") : "";
    $("#pmError").innerHTML = "";
    if (existing) applyState(existing.customizations);
    // Preselección cómoda: si sólo hay una opción obligatoria, la marcamos.
    $$("#pmOptions .choices").forEach(function (g) { var b = $$(".choice", g); if (!g.dataset.multi && b.length === 1) b[0].setAttribute("aria-pressed", "true"); });
    $("#pmAdd").firstChild.textContent = existing ? "Guardar · " : "Añadir · ";
    updatePm();
    openLayer("modal");
  }
  function applyState(cst) {
    var setGroup = function (g, vals) { $$('#pmOptions [data-group="' + g + '"] .choice').forEach(function (b) { b.setAttribute("aria-pressed", String(vals.indexOf(b.dataset.v) >= 0)); }); };
    var setSel = function (id, v) { var s = $('#pmOptions [data-sel="' + id + '"]'); if (s) s.value = v || ""; };
    ["size", "meat_choice", "side_choice", "sauce_choice"].forEach(function (g) { if (cst[g]) setGroup(g, [cst[g]]); });
    ["extra_sauces", "extra_ingredients", "remove_ingredients"].forEach(function (g) { if (cst[g]) setGroup(g, cst[g]); });
    if (cst.extra_cheese) setGroup("extra_cheese", ["1"]);
    setSel("menu_drink", cst.menu_drink);
    (cst.unit_choices || []).forEach(function (u, i) { setSel("unit_style_" + i, u.style); setSel("unit_meat_" + i, u.meat); });
    (cst.pizza_flavors || []).forEach(function (f, i) { setSel("pizza_" + i, f); });
    (cst.drink_choices || []).forEach(function (d, i) { setSel("bdrink_" + i, d); });
  }
  function readState() {
    var p = pm.product, c = p.customization_config || {}, s = {};
    var one = function (g) { var b = $('#pmOptions [data-group="' + g + '"] .choice[aria-pressed="true"]'); return b ? b.dataset.v : ""; };
    var many = function (g) { return $$('#pmOptions [data-group="' + g + '"] .choice[aria-pressed="true"]').map(function (b) { return b.dataset.v; }); };
    var sel = function (id) { var e = $('#pmOptions [data-sel="' + id + '"]'); return e ? e.value : ""; };
    s.size = one("size"); s.meat_choice = one("meat_choice"); s.side_choice = one("side_choice"); s.sauce_choice = one("sauce_choice");
    s.menu_drink = sel("menu_drink");
    s.extra_sauces = many("extra_sauces"); s.extra_ingredients = many("extra_ingredients"); s.remove_ingredients = many("remove_ingredients");
    s.extra_cheese = many("extra_cheese").length > 0;
    if (c.bundle_count) { s.unit_choices = []; for (var i = 0; i < c.bundle_count; i++) s.unit_choices.push({ style: sel("unit_style_" + i), meat: sel("unit_meat_" + i) }); }
    if (c.pizza_count) { s.pizza_flavors = []; for (var j = 0; j < c.pizza_count; j++) s.pizza_flavors.push(sel("pizza_" + j)); }
    if (c.drink_count) { s.drink_choices = []; for (var k = 0; k < c.drink_count; k++) s.drink_choices.push(sel("bdrink_" + k)); }
    s.notes = $("#pmNotes").value;
    return P.cleanCustom(p, s);
  }
  function updatePm() {
    if (!pm.product) return;
    var custom = readState();
    $("#pmQty").textContent = pm.qty;
    $("#pmPrice").textContent = money(P.unitPrice(pm.product, custom, menu) * pm.qty);
  }
  function confirmPm() {
    var custom = readState(), err = P.validate(pm.product, custom, menu);
    if (err) { $("#pmError").innerHTML = notice("err", esc(err)); var first = $("#pmOptions .req.need"); if (first) first.closest(".opt-group").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (pm.editIndex >= 0) { cart.splice(pm.editIndex, 1); }
    addLine(pm.product, custom, pm.qty);
    closeLayers();
    if (pm.editIndex >= 0) openCart();
    toast(pm.editIndex >= 0 ? "Producto actualizado" : "Añadido: " + prettyName(pm.product.name));
  }

  /* ---------- Carrito ---------- */
  function lineKey(id, c) { return id + "::" + JSON.stringify(c); }
  function addLine(p, custom, qty) {
    var key = lineKey(p.id, custom);
    var ex = cart.filter(function (l) { return l.key === key; })[0];
    if (ex) ex.quantity = Math.min(30, ex.quantity + qty);
    else cart.push({ key: key, product: p, customizations: custom, quantity: Math.min(30, qty) });
    saveCart(); renderCart(); bump();
  }
  function quickAdd(id) {
    var p = menu.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) return;
    if (P.needsCustomization(p)) openProduct(p);
    else { addLine(p, P.cleanCustom(p, {}), 1); toast("Añadido: " + prettyName(p.name)); }
  }
  function saveCart() { store.set("tk_cart_v2", cart.map(function (l) { return { id: l.product.id, c: l.customizations, q: l.quantity }; })); }
  function restoreCart() {
    var saved = store.get("tk_cart_v2", []);
    cart = [];
    (saved || []).forEach(function (s) {
      var p = menu.filter(function (x) { return x.id === s.id; })[0];
      if (!p || P.validate(p, s.c, menu)) return; // producto retirado o configuración ya no válida
      cart.push({ key: lineKey(p.id, s.c), product: p, customizations: s.c, quantity: Math.max(1, Math.min(30, s.q | 0)) });
    });
  }
  function count() { return cart.reduce(function (a, l) { return a + l.quantity; }, 0); }
  function bump() { var b = $("#cartBadge"); b.animate && b.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 350 }); }
  function fulfilment() { var r = $('input[name="fulfilment"]:checked'); return r ? r.value : "delivery"; }
  function zone() { return $("#zone").value; }
  function currentTotals() { return P.totals(cart, fulfilment(), zone(), menu); }

  function renderCart() {
    var n = count(), t = currentTotals();
    $("#cartBadge").textContent = n;
    $("#fabCount").textContent = n + (n === 1 ? " producto" : " productos");
    $("#fabSum").textContent = money(t.subtotal);
    $("#cartFab").classList.toggle("show", n > 0 && !$("#drawer").classList.contains("open"));
    if (!cart.length) {
      $("#cartLines").innerHTML = '<div class="empty" style="margin-top:10px"><div style="font-size:2.6rem">🛒</div><p>Tu pedido está vacío.</p><a class="btn btn-fire btn-sm" href="#carta" data-close>Ver la carta</a></div>';
    } else {
      $("#cartLines").innerHTML = cart.map(function (l, i) {
        var unit = P.unitPrice(l.product, l.customizations, menu), d = P.describe(l.customizations), src = photoOf(l.product);
        return '<div class="line"><div class="line-thumb">' + (src ? '<img src="' + src + '" alt="">' : esc(l.product.emoji || "🍽️")) + '</div><div><b>' + esc(prettyName(l.product.name)) + "</b>" +
          (d.length ? "<small>" + esc(d.join(" · ")) + "</small>" : "") +
          '<div class="qty" aria-label="Cantidad"><button type="button" data-dec="' + i + '" aria-label="Quitar una">−</button><output>' + l.quantity + '</output><button type="button" data-inc="' + i + '" aria-label="Añadir una">+</button></div>' +
          (P.needsCustomization(l.product) ? '<button type="button" class="link-btn" data-edit="' + i + '">Editar</button>' : "") +
          '<button type="button" class="link-btn" data-del="' + i + '">Eliminar</button></div><div class="price">' + money(unit * l.quantity) + (l.quantity > 1 ? '<br><small class="muted" style="font-weight:500">' + money(unit) + " c/u</small>" : "") + "</div></div>";
      }).join("");
    }
    renderUpsell();
    updateSums();
  }
  function renderUpsell() {
    if (!cart.length || !menuReady) { $("#upsell").classList.add("hidden"); return; }
    var fams = cart.map(function (l) { return l.product.family; });
    var hasDrink = cart.some(function (l) { var c = l.customizations; return P.isDrink(l.product) || c.menu_drink || (c.drink_choices && c.drink_choices.length) || c.fixed_drink; });
    var names = [];
    if (!hasDrink) names.push("Coca-Cola", "Fanta naranja", "Agua 33 cl");
    if (fams.indexOf("Entrantes") < 0) names.push("Patatas fritas", "Nuggets", "Alitas (6 unidades)");
    if (fams.indexOf("Postres") < 0) names.push("Baklava de pistacho");
    var items = names.map(function (n) { return menu.filter(function (p) { return p.name === n; })[0]; }).filter(Boolean).slice(0, 6);
    if (!items.length) { $("#upsell").classList.add("hidden"); return; }
    $("#upsell").classList.remove("hidden");
    $("#upsellRow").innerHTML = items.map(function (p) {
      return '<button type="button" class="upsell-item" data-add="' + esc(p.id) + '"><span class="e" aria-hidden="true">' + esc(p.emoji || "🍽️") + "</span><b>" + esc(prettyName(p.name)) + "</b><span>+" + money(P.fromPrice(p)) + "</span></button>";
    }).join("");
  }

  function updateSums() {
    var t = currentTotals(), f = fulfilment();
    $("#sSub").textContent = money(t.subtotal);
    $("#sFee").textContent = f === "delivery" ? money(t.fee) : "Gratis";
    $("#sTotal").textContent = money(step === 1 && f === "delivery" && !$("#zone").dataset.touched ? t.subtotal : t.total);
    if (step === 1 && f === "delivery" && !$("#zone").dataset.touched) $("#sFee").textContent = "Según zona";
    var msg = "", s = P.openState(new Date());
    if (!menuReady) msg = notice("err", "La carta no se ha podido cargar; no se puede enviar el pedido.");
    else if (settings.ordering_paused) msg = notice("warn", "Los pedidos online están en pausa en este momento. Llámanos al <a href=\"tel:+34937474696\">937 47 46 96</a>.");
    else if (!s.open) msg = notice("warn", "Ahora estamos cerrados. Puedes preparar tu pedido, pero sólo se puede enviar en horario: " + esc(hoursText(P.BUSINESS.hours)) + ".");
    else if (cart.length && f === "delivery" && t.missing > 0) msg = notice("warn", "Te faltan <b>" + money(t.missing) + "</b> para el pedido mínimo a domicilio (" + money(t.minimum) + " en productos).");
    $("#footMsg").innerHTML = step === 3 ? "" : msg;
    var cta = $("#mainCta");
    if (step === 1) { cta.textContent = cart.length ? "Continuar · " + money(t.subtotal) : "Ver la carta"; cta.disabled = false; }
    else if (step === 2) { cta.textContent = submitting ? "Enviando pedido…" : "Confirmar pedido · " + money(t.total); cta.disabled = submitting || !menuReady || !s.open || settings.ordering_paused || !cart.length || (f === "delivery" && t.missing > 0); }
    $("#sums").classList.toggle("hidden", step === 3 || !cart.length);
  }

  /* ---------- Capas (drawer / modal) ---------- */
  var lastFocus = null;
  function openLayer(which) {
    lastFocus = document.activeElement;
    $("#scrim").classList.add("open");
    document.body.style.overflow = "hidden";
    if (which === "drawer") { $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false"); $("#cartFab").classList.remove("show"); setTimeout(function () { var b = $("#drawer [data-close]"); if (b) b.focus(); }, 50); }
    else { $("#productModal").classList.add("open"); $("#productModal").setAttribute("aria-hidden", "false"); setTimeout(function () { var b = $("#productModal [data-close-modal]"); if (b) b.focus(); }, 50); }
  }
  function closeLayers() {
    $("#scrim").classList.remove("open");
    $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true");
    $("#productModal").classList.remove("open"); $("#productModal").setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (step === 3) { step = 1; showStep(); }
    renderCart();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (_) {}
  }
  function openCart() { closeModalOnly(); showStep(); openLayer("drawer"); renderCart(); }
  function closeModalOnly() { $("#productModal").classList.remove("open"); $("#productModal").setAttribute("aria-hidden", "true"); }

  function showStep() {
    $("#stepCart").classList.toggle("hidden", step !== 1);
    $("#stepCheckout").classList.toggle("hidden", step !== 2);
    $("#stepDone").classList.toggle("hidden", step !== 3);
    $("#drawerBack").classList.toggle("hidden", step !== 2);
    $("#drawerTitle").textContent = step === 1 ? "Tu pedido" : step === 2 ? "Tus datos" : "Pedido enviado";
    $("#st1").className = "on"; $("#st2").className = step >= 2 ? "on" : ""; $("#st3").className = step >= 3 ? "on" : "";
    $("#mainCta").classList.toggle("hidden", step === 3);
    $("#drawerBody").scrollTop = 0;
    updateSums();
  }

  /* ---------- Checkout ---------- */
  function setupCheckout() {
    var zs = $("#zone");
    zs.innerHTML = '<option value="">Elige tu zona…</option>' + P.ZONES.map(function (z) {
      return '<option value="' + z.id + '">' + esc(z.name) + " — envío " + money(z.fee) + (z.minimum !== 10 ? " · mínimo " + money(z.minimum) : "") + "</option>";
    }).join("");
    $("#tableNumber").innerHTML = '<option value="">Elige tu mesa…</option>' + P.TABLES.map(function (t) { return '<option>' + t + "</option>"; }).join("");
    $("#paySeg").innerHTML = P.BUSINESS.payments.map(function (p, i) {
      return '<input type="radio" name="payment" id="pay' + i + '" value="' + esc(p.value) + '"' + (i === 0 ? " checked" : "") + '><label for="pay' + i + '"><b>' + esc(p.label) + "</b><span>" + esc(p.hint) + "</span></label>";
    }).join("");
    if (!dineAllowed) $$(".dine").forEach(function (e) { e.remove(); });
    else { $("#fulfilmentSeg").style.setProperty("--n", 3); if (tableParam) { $("#fDine").checked = true; $("#tableNumber").value = tableParam; } }
    var saved = store.get("tk_customer", null);
    if (saved) { $("#customerName").value = saved.name || ""; $("#phone").value = saved.phone || ""; $("#address").value = saved.address || ""; if (saved.zone) { zs.value = saved.zone; zs.dataset.touched = "1"; } }
    $$('input[name="fulfilment"]').forEach(function (r) { r.addEventListener("change", onFulfilment); });
    zs.addEventListener("change", function () { zs.dataset.touched = "1"; updateSums(); });
    onFulfilment();
  }
  function onFulfilment() {
    var f = fulfilment();
    $("#deliveryFields").classList.toggle("hidden", f !== "delivery");
    $("#dineFields").classList.toggle("hidden", f !== "dine_in");
    updateSums();
  }
  function fieldError(el, on) { el.setAttribute("aria-invalid", on ? "true" : "false"); }
  function validateCheckout() {
    var f = fulfilment(), errs = [];
    var name = $("#customerName"), phone = $("#phone"), addr = $("#address"), zs = $("#zone"), tb = $("#tableNumber");
    [name, phone, addr, zs, tb].forEach(function (e) { fieldError(e, false); });
    if (name.value.trim().length < 2) { errs.push("Indica tu nombre."); fieldError(name, true); }
    var digits = phone.value.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) { errs.push("Indica un teléfono válido."); fieldError(phone, true); }
    if (f === "delivery") {
      if (!zs.value) { errs.push("Elige tu zona de entrega."); fieldError(zs, true); }
      if (addr.value.trim().length < 5) { errs.push("Escribe la dirección completa."); fieldError(addr, true); }
    }
    if (f === "dine_in" && !tb.value) { errs.push("Elige tu mesa."); fieldError(tb, true); }
    return errs;
  }
  function newIdemKey() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function submitOrder() {
    if (submitting) return;
    var errs = validateCheckout();
    if (errs.length) { $("#footMsg").innerHTML = notice("err", errs.map(esc).join("<br>")); var bad = $('#stepCheckout [aria-invalid="true"]'); if (bad) bad.focus(); return; }
    var s = P.openState(new Date());
    if (!s.open || settings.ordering_paused) { updateSums(); return; }
    var t = currentTotals(), f = fulfilment();
    if (f === "delivery" && t.missing > 0) { updateSums(); return; }
    var payload = {
      customer_name: $("#customerName").value.trim(),
      phone: $("#phone").value.trim(),
      fulfilment: f,
      zone: f === "delivery" ? zone() : f === "dine_in" ? "dine_in" : "pickup",
      address: f === "delivery" ? $("#address").value.trim() : "",
      table_number: f === "dine_in" ? $("#tableNumber").value : null,
      payment_method: ($('input[name="payment"]:checked') || {}).value || "Efectivo",
      notes: $("#notes").value.trim(),
      items: cart.map(function (l) { return { product_id: l.product.id, quantity: l.quantity, customizations: l.customizations }; })
    };
    if ($("#remember").checked) store.set("tk_customer", { name: payload.customer_name, phone: payload.phone, address: f === "delivery" ? payload.address : ($("#address").value || ""), zone: f === "delivery" ? payload.zone : "" });
    else store.del("tk_customer");
    submitting = true; updateSums();
    var shownTotal = t.total;
    client.functions.invoke("create-order", { body: payload })
      .then(function (r) {
        if (r.error) {
          // El servidor responde 4xx con un mensaje útil (horario, mínimo, producto agotado…)
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === "function") return ctx.json().then(function (j) { throw new Error((j && j.error) || "No se pudo enviar el pedido."); }, function () { throw r.error; });
          throw r.error;
        }
        if (!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || "No se pudo enviar el pedido.");
        return r.data;
      })
      .then(function (d) { orderDone(d, payload, shownTotal); })
      .catch(function (e) {
        console.error(e);
        $("#footMsg").innerHTML = notice("err", "<b>No se ha podido confirmar el pedido.</b> " + esc(e && e.message && !/fetch|network|Failed/i.test(e.message) ? e.message : "Comprueba tu conexión e inténtalo de nuevo.") + ' Si el problema sigue, llama al <a href="tel:+34937474696">937 47 46 96</a>.');
      })
      .then(function () { submitting = false; updateSums(); });
  }
  function orderDone(d, payload, shownTotal) {
    var hist = store.get("tk_orders", []);
    if (!hist.some(function (h) { return String(h.n) === String(d.order_number); })) {
      hist.unshift({ n: d.order_number, phone: payload.phone, total: d.total, at: new Date().toISOString(), f: payload.fulfilment, items: cart.map(function (l) { return l.quantity + "× " + prettyName(l.product.name); }) });
      store.set("tk_orders", hist.slice(0, 20));
    }
    var lines = cart.map(function (l) { return '<div class="sum-row"><span>' + l.quantity + "× " + esc(prettyName(l.product.name)) + "</span><span>" + money(P.unitPrice(l.product, l.customizations, menu) * l.quantity) + "</span></div>"; }).join("");
    var diff = Math.abs(Number(d.total) - shownTotal) > 0.009;
    $("#stepDone").innerHTML = '<div class="confirm"><div class="big-check"><svg class="icon" aria-hidden="true"><use href="#i-check"/></svg></div><h3>' + (d.duplicate ? "Ya teníamos tu pedido" : "¡Pedido recibido!") +
      '</h3><p class="muted">Número de pedido</p><div class="order-no">#' + esc(d.order_number) + "</div>" +
      (d.duplicate ? notice("ok", esc(d.message || "No se ha duplicado.")) : "") +
      '<p class="muted">' + (payload.fulfilment === "delivery" ? "Te lo llevamos a " + esc(payload.address) + "." : payload.fulfilment === "dine_in" ? "Te lo servimos en la mesa " + esc(payload.table_number) + "." : "Te esperamos en Carretera de Sentmenat 68–72, local 4.") + "</p>" +
      '<div class="receipt">' + lines + '<div class="sum-row"><span>' + (payload.fulfilment === "delivery" ? "Envío" : "Recogida") + "</span><span>" + (payload.fulfilment === "delivery" ? money(P.deliveryFee("delivery", payload.zone)) : "Gratis") + '</span></div><div class="sum-row total"><span>Total</span><span>' + money(d.total) + "</span></div>" +
      '<p class="muted" style="font-size:.84rem;margin:8px 0 0">Pago: ' + esc(payload.payment_method === "Efectivo" ? "efectivo" : "tarjeta") + " al " + (payload.fulfilment === "delivery" ? "recibir" : "recoger") + ".</p></div>" +
      (diff ? notice("warn", "El restaurante ha calculado un total de " + money(d.total) + ". Es el importe que pagarás.") : "") +
      '<div id="liveStatus"></div><a class="btn btn-ghost btn-block" href="#seguimiento" data-close style="margin-top:10px">Seguir mi pedido</a></div>';
    cart = []; saveCart();
    step = 3; showStep(); renderCart(); renderHistory();
    pollStatus(d.order_number, payload.phone, "#liveStatus");
  }

  /* ---------- Seguimiento ---------- */
  var STEPS = [["nuevo", "Recibido"], ["aceptado", "Aceptado"], ["preparando", "En preparación"], ["listo", "Listo"], ["en_reparto", "En reparto"], ["completado", "Entregado"]];
  function timeline(status, fulf) {
    if (status === "cancelado") return notice("err", "Este pedido ha sido cancelado. Si tienes dudas, llámanos al 937 47 46 96.");
    var steps = STEPS.filter(function (s) { return fulf === "delivery" || s[0] !== "en_reparto"; });
    var alias = { pendiente: "nuevo", en_preparacion: "preparando", listo_para_recoger: "listo", entregado: "completado" };
    status = alias[status] || status;
    var idx = steps.map(function (s) { return s[0]; }).indexOf(status);
    return '<ol class="timeline">' + steps.map(function (s, i) {
      var label = s[1]; if (s[0] === "listo" && fulf !== "delivery") label = "Listo para recoger"; if (s[0] === "completado" && fulf !== "delivery") label = "Recogido";
      return '<li class="' + (i < idx ? "done" : i === idx ? "current done" : "") + '"><span class="tl-dot">' + (i <= idx ? "✓" : "") + "</span><span>" + esc(label) + "</span></li>";
    }).join("") + "</ol>";
  }
  function track(number, phone) {
    return client.functions.invoke("track-order", { body: { order_number: String(number), phone: String(phone) } }).then(function (r) {
      if (r.error) {
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === "function") return ctx.json().then(function (j) { throw new Error((j && j.error) || "No se pudo consultar."); }, function () { throw new Error("No se pudo consultar el pedido."); });
        throw new Error("No se pudo consultar el pedido.");
      }
      if (!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || "No se pudo consultar.");
      return r.data;
    });
  }
  var pollTimer = null;
  function pollStatus(number, phone, target) {
    clearInterval(pollTimer);
    var run = function () {
      if (!client) return;
      track(number, phone).then(function (d) {
        var el = $(target); if (!el) { clearInterval(pollTimer); return; }
        el.innerHTML = '<div class="panel" style="padding:16px;margin-top:12px;text-align:left"><b>Estado: ' + esc(d.status_label) + "</b>" + timeline(d.status, d.fulfilment) + "</div>";
        if (d.status === "completado" || d.status === "cancelado") clearInterval(pollTimer);
      }).catch(function () {});
    };
    run(); pollTimer = setInterval(run, 20000);
  }
  function renderHistory() {
    var hist = store.get("tk_orders", []);
    $("#history").innerHTML = hist.length ? hist.map(function (h) {
      return '<button type="button" data-track="' + esc(h.n) + '" data-phone="' + esc(h.phone) + '"><span><b>Pedido #' + esc(h.n) + '</b><br><small class="muted">' + esc(new Date(h.at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })) + " · " + esc((h.items || []).slice(0, 2).join(", ")) + ((h.items || []).length > 2 ? "…" : "") + '</small></span><span class="price">' + money(h.total) + "</span></button>";
    }).join("") : '<p class="muted">Aún no has hecho pedidos desde este dispositivo.</p>';
  }
  function onTrackSubmit(ev) {
    ev.preventDefault();
    var n = $("#trackNumber").value.trim(), ph = $("#trackPhone").value.trim();
    if (!/^\d{1,12}$/.test(n) || ph.replace(/\D/g, "").length < 6) { $("#trackResult").innerHTML = notice("err", "Introduce el número de pedido y el teléfono que usaste."); return; }
    if (!client) { $("#trackResult").innerHTML = notice("err", "El servicio no está disponible ahora mismo."); return; }
    var b = $("#trackBtn"); b.disabled = true; b.textContent = "Consultando…";
    track(n, ph).then(function (d) {
      $("#trackResult").innerHTML = '<div style="margin-top:16px"><b>Pedido #' + esc(d.order_number) + " · " + esc(d.status_label) + "</b>" + timeline(d.status, d.fulfilment) + "</div>";
    }).catch(function (e) { $("#trackResult").innerHTML = notice("err", esc(e.message)); })
      .then(function () { b.disabled = false; b.textContent = "Consultar estado"; });
  }

  /* ---------- Varios ---------- */
  function renderZones() {
    $("#zonesBody").innerHTML = P.ZONES.map(function (z) { return "<tr><td><b>" + esc(z.name) + "</b></td><td>" + money(z.fee) + "</td><td>" + money(z.minimum) + "</td></tr>"; }).join("") +
      '<tr><td><b>Recogida en el local</b></td><td>Gratis</td><td>—</td></tr>';
  }
  var io = null;
  function observeReveal() {
    if (!("IntersectionObserver" in window)) { $$(".reveal").forEach(function (e) { e.classList.add("in"); }); return; }
    io = io || new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
    $$(".reveal:not(.in)").forEach(function (e) { io.observe(e); });
  }

  /* ---------- Eventos ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var add = t.closest("[data-add]"); if (add) { quickAdd(add.dataset.add); return; }
    if (t.closest("[data-open-cart]")) { step = cart.length ? (step === 3 ? 1 : step) : 1; openCart(); return; }
    if (t.closest("[data-close-modal]")) { closeLayers(); return; }
    if (t.closest("[data-close]")) { closeLayers(); return; }
    var tab = t.closest("#tabs .tab"); if (tab) { setFamily(tab.dataset.family); return; }
    var ch = t.closest(".choice");
    if (ch && ch.closest("#pmOptions")) {
      var g = ch.parentElement, multi = g.dataset.multi, on = ch.getAttribute("aria-pressed") !== "true";
      if (!multi) { $$(".choice", g).forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); ch.setAttribute("aria-pressed", "true"); }
      else {
        if (on && $$('.choice[aria-pressed="true"]', g).length >= Number(multi)) { toast("Máximo " + multi + " opciones"); return; }
        ch.setAttribute("aria-pressed", String(on));
      }
      updatePm(); return;
    }
    var inc = t.closest("[data-inc]"), dec = t.closest("[data-dec]"), del = t.closest("[data-del]"), edit = t.closest("[data-edit]");
    if (inc) { var l = cart[+inc.dataset.inc]; l.quantity = Math.min(30, l.quantity + 1); saveCart(); renderCart(); return; }
    if (dec) { var i = +dec.dataset.dec; cart[i].quantity--; if (cart[i].quantity <= 0) cart.splice(i, 1); saveCart(); renderCart(); return; }
    if (del) { cart.splice(+del.dataset.del, 1); saveCart(); renderCart(); toast("Producto eliminado"); return; }
    if (edit) { var li = cart[+edit.dataset.edit]; $("#drawer").classList.remove("open"); openProduct(li.product, li, +edit.dataset.edit); return; }
    var tr = t.closest("[data-track]"); if (tr) { $("#trackNumber").value = tr.dataset.track; $("#trackPhone").value = tr.dataset.phone; $("#trackForm").requestSubmit ? $("#trackForm").requestSubmit() : onTrackSubmit(new Event("submit")); return; }
  });
  $("#scrim").addEventListener("click", closeLayers);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("#scrim").classList.contains("open")) closeLayers(); });
  $("#productModal").addEventListener("change", updatePm);
  $("#pmPlus").addEventListener("click", function () { pm.qty = Math.min(30, pm.qty + 1); updatePm(); });
  $("#pmMinus").addEventListener("click", function () { pm.qty = Math.max(1, pm.qty - 1); updatePm(); });
  $("#pmAdd").addEventListener("click", confirmPm);
  $("#mainCta").addEventListener("click", function () {
    if (step === 1) { if (!cart.length) { closeLayers(); location.hash = "#carta"; return; } step = 2; showStep(); var first = $("#customerName"); if (first && !first.value) setTimeout(function () { first.focus(); }, 60); }
    else if (step === 2) submitOrder();
  });
  $("#drawerBack").addEventListener("click", function () { step = 1; showStep(); });
  $("#stepCheckout").addEventListener("submit", function (e) { e.preventDefault(); submitOrder(); });
  $("#search").addEventListener("input", function (e) { query = e.target.value; if (query && activeFamily !== "Todas") { activeFamily = "Todas"; renderTabs(); } renderMenu(); });
  $("#trackForm").addEventListener("submit", onTrackSubmit);
  window.addEventListener("scroll", function () { $("#header").classList.toggle("scrolled", window.scrollY > 10); }, { passive: true });

  /* ---------- Arranque ---------- */
  $("#year").textContent = new Date().getFullYear();
  setupCheckout(); renderZones(); renderHistory(); updateLive(); observeReveal(); renderCart();
  setInterval(function () { updateLive(); updateSums(); }, 30000);
  loadMenu(); loadSettings();
  window.__tk = { cart: function () { return cart; }, menu: function () { return menu; }, totals: currentTotals };
})();
