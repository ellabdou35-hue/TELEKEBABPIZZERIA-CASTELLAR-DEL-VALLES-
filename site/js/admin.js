/* Tele Kebab Pizzería · Panel de administración */
(function () {
  "use strict";
  var P = window.TKPricing, I = window.TKInsights;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (n) { return Number(n || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" }); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var cfg = window.TELEKEBAB_CONFIG || {};
  var client = window.supabase.createClient(cfg.url, cfg.anonKey);

  var S = {
    session: null, me: null, perms: [], ops: [], hist: [], histFrom: null, products: [], staff: null,
    features: { whoami: null, staff: null, settings: null, events: null, menuFull: null, upload: null },
    view: "resumen", filter: "activos", known: null, sound: false, polling: null, busy: false, histLoadedAt: 0
  };
  var STATUS = { nuevo: "Nuevo", aceptado: "Aceptado", preparando: "En cocina", listo: "Listo", en_reparto: "En reparto", completado: "Entregado", cancelado: "Cancelado" };
  var ZONES = { castellar: "Castellar del Vallès", sentmenat: "Sentmenat", airesol_ab: "Airesol A/B", airesol_d: "Airesol D", sant_feliu: "Sant Feliu del Racó", sant_llorenc_savall: "Sant Llorenç Savall", nearby: "Zona cercana", pickup: "Recogida", dine_in: "En el local" };
  var CANCEL_REASONS = ["Cliente lo pide", "Producto agotado", "Fuera de zona", "Cliente no contesta", "Cerrando", "Pedido de prueba", "Otro"];
  var ALLERGY = /alerg|gluten|celiac|celíac|intoleran|lactosa|frutos secos|cacahuet|marisco|huevo|sésamo|sesamo|vegano|vegetarian/i;
  var ROLE_LABEL = { owner: "Propietario", manager: "Encargado", staff: "Cocina / reparto" };
  var PERM_LABEL = { orders_view: "Ver pedidos", orders_update: "Avanzar pedidos", orders_cancel: "Cancelar pedidos", stock: "Marcar agotados", menu_edit: "Editar carta y precios", reports: "Ventas e histórico", staff_manage: "Gestionar equipo", settings: "Ajustes de la web" };
  var ROLE_DEFAULTS = { owner: Object.keys(PERM_LABEL), manager: ["orders_view", "orders_update", "orders_cancel", "stock", "menu_edit", "reports"], staff: ["orders_view", "orders_update", "stock"] };

  /* ---------- Utilidades ---------- */
  var toastT;
  function toast(msg, err) { var t = $("#toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(function () { t.className = "toast"; }, 3200); }
  function notice(k, h) { return '<div class="notice ' + k + '">' + h + "</div>"; }
  function can(p) { return S.perms.indexOf(p) >= 0; }
  function time(iso) { return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }); }
  function dateTime(iso) { return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }); }
  function minsAgo(iso) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }
  function ApiError(status, msg) { var e = new Error(msg); e.status = status; return e; }

  function api(name, body) {
    var token = S.session && S.session.access_token;
    return fetch(cfg.url + "/functions/v1/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: "Bearer " + (token || cfg.anonKey) },
      body: body === undefined ? "" : JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : {}; } catch (_) { d = {}; }
        if (!r.ok) {
          if (r.status === 401) onSessionLost();
          throw ApiError(r.status, (d && (d.error || d.message)) || ("Error " + r.status));
        }
        return d;
      });
    });
  }
  function notDeployed(e) { return e && (e.status === 404 || (e.status === 503 && /activad/i.test(e.message))); }

  /* ---------- Sesión ---------- */
  function showLogin(msg) {
    $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
    if (msg) $("#loginMsg").innerHTML = notice("err", esc(msg));
    stopPolling();
  }
  function onSessionLost() { if (S.session) { S.session = null; showLogin("La sesión ha caducado. Vuelve a entrar."); } }
  $("#loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("#loginBtn"); b.disabled = true; b.textContent = "Comprobando…"; $("#loginMsg").innerHTML = "";
    client.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value }).then(function (r) {
      if (r.error) throw r.error;
      S.session = r.data.session; $("#password").value = "";
      return start();
    }).catch(function () { $("#loginMsg").innerHTML = notice("err", "Correo o contraseña incorrectos, o cuenta sin acceso."); })
      .then(function () { b.disabled = false; b.textContent = "Entrar"; });
  });
  $("#logout").addEventListener("click", function () { client.auth.signOut().then(function () { S.session = null; S.me = null; location.hash = ""; showLogin(); }); });

  function resolveIdentity() {
    return api("whoami").then(function (d) { S.features.whoami = true; return d; }).catch(function (e) {
      if (e.status === 403) throw e;
      if (!notDeployed(e)) throw e;
      // Compatibilidad con el servidor actual (sin whoami): el rol se deduce de owner-analytics.
      S.features.whoami = false;
      return api("owner-analytics").then(function () { return { role: "owner", permissions: ROLE_DEFAULTS.owner }; })
        .catch(function (e2) { if (e2.status === 403) return { role: "staff", permissions: ROLE_DEFAULTS.staff }; throw e2; })
        .then(function (r) { var u = S.session.user || {}; return { user_id: u.id, email: u.email, display_name: (u.email || "").split("@")[0], role: r.role, permissions: r.permissions }; });
    });
  }

  function start() {
    return resolveIdentity().then(function (me) {
      S.me = me; S.perms = Array.isArray(me.permissions) ? me.permissions : (ROLE_DEFAULTS[me.role] || ROLE_DEFAULTS.staff);
      $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
      $("#whoName").textContent = me.display_name || me.email;
      $("#whoEmail").textContent = me.email || "";
      $("#whoRole").textContent = ROLE_LABEL[me.role] || me.role;
      $("#whoAvatar").textContent = String(me.display_name || me.email || "?").charAt(0).toUpperCase();
      applyPerms(); buildTabbar();
      go(location.hash.replace("#", "") || "resumen");
      refreshOps(true);
      if (can("reports")) loadHistory(90);
      loadProducts();
      startPolling(); subscribeRealtime();
    }).catch(function (e) {
      client.auth.signOut();
      showLogin(e.status === 403 ? e.message : "No se pudo abrir el panel: " + e.message);
    });
  }
  function applyPerms() { $$("[data-perm]").forEach(function (el) { el.classList.toggle("hidden", !can(el.dataset.perm)); }); }
  function buildTabbar() {
    $("#tabbar").innerHTML = $$("#nav a").filter(function (a) { return !a.classList.contains("hidden"); }).map(function (a) { return a.outerHTML.replace('id="navNew"', 'data-new'); }).join("");
  }

  /* ---------- Navegación ---------- */
  var TITLES = { resumen: "Resumen", pedidos: "Pedidos", carta: "Carta", equipo: "Equipo", asistente: "Asistente", ajustes: "Ajustes" };
  function go(v) {
    if (!TITLES[v]) v = "resumen";
    var link = $('#nav a[data-view="' + v + '"]');
    if (link && link.classList.contains("hidden")) v = "resumen";
    S.view = v;
    $$(".view").forEach(function (s) { s.classList.toggle("hidden", s.id !== "v-" + v); });
    $$("#nav a, #tabbar a").forEach(function (a) { a.classList.toggle("on", a.dataset.view === v); });
    $("#viewTitle").textContent = TITLES[v];
    render();
  }
  window.addEventListener("hashchange", function () { if (S.me) go(location.hash.replace("#", "")); });
  function render() {
    if (S.view === "resumen") renderDashboard();
    if (S.view === "pedidos") renderOrders();
    if (S.view === "carta") renderProducts();
    if (S.view === "equipo") renderTeam();
    if (S.view === "asistente") renderAssistant();
    if (S.view === "ajustes") renderSettings();
  }

  /* ---------- Datos de pedidos ---------- */
  function setConn(kind, text) { $("#conn").innerHTML = '<span class="dot ' + kind + '"></span><span>' + esc(text) + "</span>"; }
  function refreshOps(first) {
    if (S.busy || !S.session) return Promise.resolve();
    S.busy = true;
    return api("admin-orders", { view: "operational", date: I.madridDay(new Date()) }).then(function (d) {
      var orders = d.orders || [];
      var ids = orders.map(function (o) { return o.id; });
      if (S.known && !first) {
        var fresh = orders.filter(function (o) { return S.known.indexOf(o.id) < 0 && o.status === "nuevo"; });
        if (fresh.length) { alarm(); toast(fresh.length === 1 ? "Nuevo pedido #" + fresh[0].order_number : fresh.length + " pedidos nuevos"); notify(fresh); }
      }
      S.known = (S.known || []).concat(ids.filter(function (id) { return (S.known || []).indexOf(id) < 0; }));
      S.ops = orders;
      var n = orders.filter(function (o) { return o.status === "nuevo"; }).length;
      $$("#navNew, #tabbar [data-new]").forEach(function (e) { e.textContent = n; e.classList.toggle("hidden", !n); });
      document.title = (n ? "(" + n + ") " : "") + "Panel · Tele Kebab";
      setConn("ok", "En directo · " + time(new Date().toISOString()));
      if (["resumen", "pedidos"].indexOf(S.view) >= 0) render();
    }).catch(function (e) { setConn("err", e.status === 403 ? "Sin permiso" : "Sin conexión · reintentando"); })
      .then(function () { S.busy = false; });
  }
  function loadHistory(days) {
    if (!can("reports")) return Promise.resolve();
    var today = I.madridDay(new Date()), from = I.addDays(today, -(days - 1));
    if (S.histFrom && S.histFrom <= from && Date.now() - S.histLoadedAt < 120000) return Promise.resolve();
    return api("admin-orders", { from: from, to: today }).then(function (d) {
      S.hist = d.orders || []; S.histFrom = from; S.histLoadedAt = Date.now();
      if (["resumen", "asistente", "carta"].indexOf(S.view) >= 0) render();
    }).catch(function (e) { toast("No se pudo cargar el histórico: " + e.message, true); });
  }
  function startPolling() {
    stopPolling();
    S.polling = setInterval(function () { if (!document.hidden) refreshOps(); }, 5000);
    S.histPoll = setInterval(function () { if (!document.hidden && can("reports")) { S.histLoadedAt = 0; loadHistory(S.histFrom ? Math.round((Date.now() - new Date(S.histFrom).getTime()) / 864e5) + 1 : 90); } }, 120000);
  }
  function stopPolling() { clearInterval(S.polling); clearInterval(S.histPoll); }
  function subscribeRealtime() {
    try { client.channel("tk-admin").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, function () { refreshOps(); }).subscribe(); } catch (_) {}
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S.me) refreshOps(); });
  $("#refreshBtn").addEventListener("click", function () { S.histLoadedAt = 0; refreshOps(); loadHistory(90); loadProducts(); });

  /* ---------- Avisos ---------- */
  var actx = null;
  $("#soundBtn").addEventListener("click", function () {
    S.sound = !S.sound;
    this.setAttribute("aria-pressed", String(S.sound));
    this.querySelector("span").textContent = S.sound ? "Aviso activado" : "Activar aviso";
    if (S.sound) { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); alarm(); if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }
  });
  function alarm() {
    if (!S.sound || !actx) return;
    var t0 = actx.currentTime;
    for (var r = 0; r < 3; r++) for (var i = 0; i < 3; i++) {
      var t = t0 + r * 1.2 + i * 0.22, o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = i % 2 ? 784 : 1046;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.2);
    }
  }
  function notify(fresh) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    fresh.forEach(function (o) { try { new Notification("Nuevo pedido #" + o.order_number, { body: o.customer_name + " · " + money(o.total), tag: "tk-" + o.id }); } catch (_) {} });
  }

  /* ---------- Resumen ---------- */
  function renderDashboard() {
    var today = I.madridDay(new Date());
    var todays = S.ops.filter(function (o) { return I.parts(o.created_at).day === today; });
    var c = function (st) { return S.ops.filter(function (o) { return st.indexOf(o.status) >= 0; }).length; };
    var tiles = [["k-new", "Nuevos", c(["nuevo"]), "pendientes de aceptar"], ["k-cook", "En cocina", c(["aceptado", "preparando"]), "aceptados o preparando"], ["k-ready", "Listos", c(["listo"]), "para recoger o salir"], ["k-route", "En reparto", c(["en_reparto"]), "camino del cliente"], ["k-done", "Entregados hoy", todays.filter(function (o) { return o.status === "completado"; }).length, todays.length + " pedidos hoy"]];
    $("#kpiOps").innerHTML = tiles.map(function (t) { return '<div class="kpi ' + t[0] + '"><span>' + t[1] + "</span><b>" + t[2] + "</b><small>" + t[3] + "</small></div>"; }).join("");
    if (can("reports")) {
      var all = mergeOrders();
      var k = I.kpis(all, new Date());
      $("#kpiMoney").innerHTML = [["Ventas hoy", k.today.sales, k.today.n + " pedidos"], ["Esta semana", k.week.sales, k.week.n + " pedidos · desde el lunes"], ["Este mes", k.month.sales, k.month.n + " pedidos"], ["Ticket medio (mes)", k.month.avg, k.cancelledToday ? k.cancelledToday + " cancelados hoy" : "sin cancelados hoy"]]
        .map(function (t) { return '<div class="kpi"><span>' + t[0] + "</span><b>" + money(t[1]) + "</b><small>" + t[2] + "</small></div>"; }).join("");
      renderChart(I.daily(all, 14, new Date()));
    }
    var src = can("reports") ? recent(mergeOrders(), 30) : todays;
    var top = I.topProducts(src, 6);
    $("#topList").innerHTML = top.length ? '<ol class="rank">' + top.map(function (t, i) { return '<li><span class="n">' + (i + 1) + "</span><span>" + esc(t.name) + '</span><b>' + t.qty + '</b><span class="meter"><i style="width:' + Math.round(t.qty / top[0].qty * 100) + '%"></i></span></li>'; }).join("") + "</ol>" + (can("reports") ? "" : '<p class="muted small">Datos de hoy.</p>') : '<div class="empty">Aún no hay ventas en este periodo.</div>';
    var active = S.ops.filter(function (o) { return ["nuevo", "aceptado", "preparando", "listo", "en_reparto"].indexOf(o.status) >= 0; });
    $("#activeMini").innerHTML = active.length ? '<ul class="feed">' + active.slice(0, 8).map(function (o) { return '<li><time>' + time(o.created_at) + "</time><span><b>#" + o.order_number + "</b> · " + esc(o.customer_name) + " · " + money(o.total) + ' <span class="badge b-' + o.status + '">' + STATUS[o.status] + "</span></span></li>"; }).join("") + "</ul>" : '<div class="empty">No hay pedidos en curso.</div>';
    renderActivity();
  }
  function recent(list, days) { var from = I.addDays(I.madridDay(new Date()), -(days - 1)); return list.filter(function (o) { return I.parts(o.created_at).day >= from; }); }
  function mergeOrders() { var map = {}; S.hist.concat(S.ops).forEach(function (o) { map[o.id] = o; }); return Object.keys(map).map(function (k) { return map[k]; }); }
  function renderChart(data) {
    var max = Math.max.apply(null, data.map(function (d) { return d.sales; }).concat([1])), W = 560, H = 190, bw = W / data.length;
    var total = data.reduce(function (a, d) { return a + d.sales; }, 0);
    $("#chartNote").textContent = "Total " + money(total);
    $("#chart").innerHTML = '<svg viewBox="0 0 ' + W + " " + (H + 34) + '" role="img" aria-label="Ventas diarias de los últimos 14 días"><defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb547"/><stop offset="1" stop-color="#ff5a1f"/></linearGradient></defs>' +
      data.map(function (d, i) {
        var h = Math.max(d.sales ? 3 : 0, d.sales / max * H), x = i * bw + 6;
        var lbl = new Date(d.day + "T12:00:00Z").toLocaleDateString("es-ES", { day: "numeric", month: "numeric" });
        return '<g><title>' + lbl + ": " + money(d.sales) + '</title><rect class="bar" x="' + x + '" y="' + (H - h) + '" width="' + (bw - 12) + '" height="' + h + '" rx="5"/>' +
          (d.sales ? '<text x="' + (x + (bw - 12) / 2) + '" y="' + (H - h - 5) + '" text-anchor="middle">' + Math.round(d.sales) + "</text>" : "") +
          '<text x="' + (x + (bw - 12) / 2) + '" y="' + (H + 18) + '" text-anchor="middle">' + lbl + "</text></g>";
      }).join("") + "</svg>";
  }
  function renderActivity() {
    var el = $("#activity");
    if (can("reports") && S.features.events !== false) {
      api("admin-orders", { view: "events", limit: 15 }).then(function (d) {
        if (d.unavailable) { S.features.events = false; return renderActivity(); }
        S.features.events = true;
        el.innerHTML = (d.events || []).length ? '<ul class="feed">' + d.events.map(function (e) { return "<li><time>" + time(e.created_at) + "</time><span><b>" + esc(e.actor_name || "Sistema") + "</b> pasó el <b>#" + esc(e.orders && e.orders.order_number) + "</b> a " + esc(STATUS[e.to_status] || e.to_status) + (e.note ? ' <span class="muted">· ' + esc(e.note) + "</span>" : "") + "</span></li>"; }).join("") + "</ul>" : '<div class="empty">Sin actividad registrada todavía.</div>';
      }).catch(function () { S.features.events = false; renderActivity(); });
      return;
    }
    var list = mergeOrders().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 10);
    el.innerHTML = (list.length ? '<ul class="feed">' + list.map(function (o) { return "<li><time>" + time(o.created_at) + "</time><span>Pedido <b>#" + o.order_number + "</b> de " + esc(o.customer_name) + " · " + money(o.total) + ' <span class="badge b-' + o.status + '">' + STATUS[o.status] + "</span></span></li>"; }).join("") + "</ul>" : '<div class="empty">Sin pedidos todavía.</div>') +
      (can("reports") ? '<p class="muted small">El registro de quién cambia cada estado se activa con la actualización del servidor pendiente de autorizar.</p>' : "");
  }

  /* ---------- Pedidos ---------- */
  $("#orderFilter").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.filter = b.dataset.f; $$("#orderFilter button").forEach(function (x) { x.classList.toggle("on", x === b); });
    $("#histBar").classList.toggle("hidden", S.filter !== "historico");
    if (S.filter === "historico" && !$("#hFrom").value) { var t = I.madridDay(new Date()); $("#hTo").value = t; $("#hFrom").value = I.addDays(t, -6); loadRange(); }
    renderOrders();
  });
  $("#orderSearch").addEventListener("input", renderOrders);
  var rangeOrders = [];
  function loadRange() {
    var f = $("#hFrom").value, t = $("#hTo").value;
    if (!f || !t || f > t) { toast("Elige un periodo válido", true); return; }
    $("#hInfo").textContent = "Cargando…";
    api("admin-orders", { from: f, to: t }).then(function (d) { rangeOrders = d.orders || []; var v = rangeOrders.filter(function (o) { return o.status !== "cancelado"; }); $("#hInfo").textContent = rangeOrders.length + " pedidos · " + money(v.reduce(function (a, o) { return a + Number(o.total); }, 0)) + " sin cancelados"; renderOrders(); })
      .catch(function (e) { $("#hInfo").textContent = e.message; });
  }
  $("#hLoad").addEventListener("click", loadRange);
  $("#hCsv").addEventListener("click", function () {
    if (!rangeOrders.length) { toast("Carga primero un periodo", true); return; }
    var rows = [["numero", "fecha", "estado", "tipo", "zona", "cliente", "telefono", "pago", "productos", "envio", "total"]].concat(rangeOrders.map(function (o) { return [o.order_number, dateTime(o.created_at), o.status, o.fulfilment, ZONES[o.zone] || o.zone, o.customer_name, o.phone, o.payment_method, o.subtotal, o.delivery_fee, o.total]; }));
    var csv = "﻿" + rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(";"); }).join("\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "pedidos_" + $("#hFrom").value + "_" + $("#hTo").value + ".csv"; a.click();
  });
  function filteredOrders() {
    var q = $("#orderSearch").value.trim().toLowerCase(), f = S.filter, today = I.madridDay(new Date());
    var list = f === "historico" ? rangeOrders : S.ops;
    list = list.filter(function (o) {
      if (f === "activos" && ["nuevo", "aceptado", "preparando", "listo", "en_reparto"].indexOf(o.status) < 0) return false;
      if (f === "nuevo" && o.status !== "nuevo") return false;
      if (f === "preparando" && ["aceptado", "preparando"].indexOf(o.status) < 0) return false;
      if (f === "listo" && ["listo", "en_reparto"].indexOf(o.status) < 0) return false;
      if (f === "hoy" && I.parts(o.created_at).day !== today) return false;
      return !q || (String(o.order_number) + " " + o.customer_name + " " + o.phone + " " + (o.address || "")).toLowerCase().indexOf(q) >= 0;
    });
    var rank = { nuevo: 0, aceptado: 1, preparando: 1, listo: 2, en_reparto: 3, completado: 4, cancelado: 5 };
    return list.sort(function (a, b) { return f === "historico" ? new Date(b.created_at) - new Date(a.created_at) : (rank[a.status] - rank[b.status]) || (new Date(a.created_at) - new Date(b.created_at)); });
  }
  function nextStep(o) {
    if (o.status === "nuevo") return ["aceptado", "Aceptar"];
    if (o.status === "aceptado") return ["preparando", "Empezar a preparar"];
    if (o.status === "preparando") return ["listo", "Marcar listo"];
    if (o.status === "listo") return o.fulfilment === "delivery" ? ["en_reparto", "Enviar a reparto"] : ["completado", "Entregado"];
    if (o.status === "en_reparto") return ["completado", "Entregado"];
    return null;
  }
  function itemsHtml(o) {
    return '<ul class="items">' + (o.order_items || []).map(function (i) {
      var d = P.describe(i.customizations || {});
      return '<li><span class="q">' + i.quantity + "×</span><span>" + esc(i.product_name) + (d.length ? "<small>" + esc(d.join(" · ")) + "</small>" : "") + "</span><span>" + money(i.line_total) + "</span></li>";
    }).join("") + "</ul>";
  }
  function orderCard(o) {
    var n = nextStep(o), age = minsAgo(o.created_at), active = ["nuevo", "aceptado", "preparando", "listo", "en_reparto"].indexOf(o.status) >= 0;
    var notes = [o.notes].concat((o.order_items || []).map(function (i) { return i.customizations && i.customizations.notes; })).filter(Boolean).join(" ");
    var type = o.fulfilment === "delivery" ? "🛵 Domicilio" : o.fulfilment === "dine_in" ? "🍽️ Mesa " + esc(o.table_number || "?") : "🛍️ Recoger";
    var maps = o.fulfilment === "delivery" && o.address ? ' · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ", " + (ZONES[o.zone] || "")) + '">Mapa</a>' : "";
    return '<article class="order s-' + o.status + '" data-id="' + o.id + '"><div class="order-top"><div><div class="order-no">#' + o.order_number + '</div><span class="age' + (active && age > 30 ? " late" : "") + '">' + time(o.created_at) + (active ? " · hace " + age + " min" : " · " + dateTime(o.created_at)) + "</span></div>" +
      '<div style="text-align:right"><span class="badge b-' + o.status + '">' + STATUS[o.status] + '</span><br><span class="badge b-type" style="margin-top:6px">' + type + "</span></div></div>" +
      '<div class="order-meta"><span><b>' + esc(o.customer_name) + '</b> · <a href="tel:' + esc(String(o.phone).replace(/\s/g, "")) + '">' + esc(o.phone) + "</a></span>" +
      (o.fulfilment === "delivery" ? "<span>" + esc(ZONES[o.zone] || o.zone) + " · " + esc(o.address) + maps + "</span>" : "") +
      "<span>Pago: " + esc(o.payment_method) + "</span>" + (o.estimated_ready_at && active ? "<span>Listo aprox. " + time(o.estimated_ready_at) + "</span>" : "") + (o.cancel_reason ? "<span>Motivo: " + esc(o.cancel_reason) + "</span>" : "") + "</div>" +
      (notes && ALLERGY.test(notes) ? '<div class="allergy">⚠️ Revisar alergias: ' + esc(notes) + "</div>" : o.notes ? '<div class="muted small">Notas: ' + esc(o.notes) + "</div>" : "") +
      itemsHtml(o) + '<div class="order-total"><span>Total' + (Number(o.delivery_fee) ? ' <small class="muted" style="font-weight:500;font-family:var(--font-body);font-size:.8rem">(envío ' + money(o.delivery_fee) + ")</small>" : "") + "</span><span>" + money(o.total) + "</span></div>" +
      '<div class="order-actions">' + (n && can("orders_update") ? '<button class="btn ' + (o.status === "nuevo" ? "btn-fire" : "btn-ok") + ' btn-sm" data-act="next" data-to="' + n[0] + '">' + n[1] + "</button>" : "") +
      (active && can("orders_cancel") ? '<button class="btn btn-danger btn-sm" data-act="cancel">' + (o.status === "nuevo" ? "Rechazar" : "Cancelar") + "</button>" : "") +
      '<button class="btn btn-ghost btn-sm" data-act="print"><svg class="icon"><use href="#i-print"/></svg>Ticket</button></div></article>';
  }
  function renderOrders() {
    var list = filteredOrders();
    $("#orderList").innerHTML = list.length ? list.map(orderCard).join("") : '<div class="empty" style="grid-column:1/-1">' + (S.filter === "historico" ? "Elige un periodo y pulsa «Cargar»." : "No hay pedidos en esta vista.") + "</div>";
  }
  $("#orderList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var id = b.closest(".order").dataset.id;
    var o = S.ops.filter(function (x) { return x.id === id; })[0] || rangeOrders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    if (b.dataset.act === "print") return printTicket(o);
    if (b.dataset.act === "cancel") return openCancel(o);
    if (b.dataset.to === "aceptado") return openAccept(o);
    setStatus(o, b.dataset.to, {}, b);
  });
  function setStatus(o, status, extra, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    return api("update-order-status", Object.assign({ id: o.id, status: status, expected_status: o.status }, extra || {}))
      .then(function () { o.status = status; toast("#" + o.order_number + " → " + STATUS[status]); closeSheet(); return refreshOps(); })
      .catch(function (e) { toast(e.status === 409 ? e.message : "No se pudo actualizar: " + e.message, true); refreshOps(); if (btn) btn.disabled = false; });
  }
  function openAccept(o) {
    openSheet("Aceptar pedido #" + o.order_number, '<p class="muted">¿En cuánto tiempo estará listo? El tiempo se guarda con el pedido.</p><div class="grid2">' + [15, 20, 30, 45, 60].map(function (n) { return '<button class="btn btn-ghost" data-eta="' + n + '">' + n + " min</button>"; }).join("") + '<button class="btn btn-ghost" data-eta="0">Sin indicar</button></div>' + itemsHtml(o), "");
    $$("#sheetBody [data-eta]").forEach(function (b) { b.addEventListener("click", function () { var n = +b.dataset.eta; setStatus(o, "aceptado", n ? { estimated_ready_at: new Date(Date.now() + n * 60000).toISOString() } : {}, b); }); });
  }
  function openCancel(o) {
    openSheet((o.status === "nuevo" ? "Rechazar" : "Cancelar") + " pedido #" + o.order_number, '<p class="muted">Elige el motivo. Queda registrado en el pedido.</p>' + CANCEL_REASONS.map(function (r, i) { return '<label class="check"><input type="radio" name="cr" value="' + esc(r) + '"' + (i ? "" : "") + "> " + esc(r) + "</label>"; }).join("") + '<div class="field" style="margin-top:10px"><input class="input" id="crOther" placeholder="Detalle (obligatorio si eliges «Otro»)" maxlength="150"></div>' + notice("warn", "Si el cliente ya está esperando, llámale: <a href=\"tel:" + esc(o.phone) + '">' + esc(o.phone) + "</a>"),
      '<button class="btn btn-ghost" data-close>Volver</button><button class="btn btn-danger" id="doCancel">Confirmar</button>');
    $("#doCancel").addEventListener("click", function () {
      var r = ($('input[name="cr"]:checked') || {}).value, other = $("#crOther").value.trim();
      if (!r) return toast("Elige un motivo", true);
      if (r === "Otro" && !other) return toast("Escribe el motivo", true);
      setStatus(o, "cancelado", { cancel_reason: r === "Otro" ? "Otro: " + other : r + (other ? ": " + other : "") }, this);
    });
  }

  /* ---------- Tickets ---------- */
  var bt = null;
  var BT_SERVICES = ["000018f0-0000-1000-8000-00805f9b34fb", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "0000ff00-0000-1000-8000-00805f9b34fb", "0000ae30-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2"];
  $("#btPrinter").addEventListener("click", function () {
    if (!navigator.bluetooth) return toast("Este navegador no admite Bluetooth. Usa Chrome en Android.", true);
    navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES }).then(function (dev) {
      return dev.gatt.connect().then(function (server) {
        return server.getPrimaryServices().then(function (svcs) {
          return Promise.all(svcs.map(function (s) { return s.getCharacteristics().catch(function () { return []; }); }));
        }).then(function (lists) {
          var ch = [].concat.apply([], lists).filter(function (c) { return c.properties.write || c.properties.writeWithoutResponse; })[0];
          if (!ch) throw new Error("La impresora no ofrece un canal BLE de escritura compatible.");
          bt = ch; $("#printerState").textContent = "Impresora conectada: " + (dev.name || "Bluetooth");
          dev.addEventListener("gattserverdisconnected", function () { bt = null; $("#printerState").textContent = "Impresora desconectada · impresión estándar"; });
        });
      });
    }).catch(function (e) { if (e.name !== "NotFoundError") toast("No se pudo conectar: " + e.message, true); });
  });
  function ticketLines(o) {
    var L = ["TELE KEBAB PIZZERIA", "Ctra. Sentmenat 68-72, local 4", "Tel. 937 47 46 96", "--------------------------------", "PEDIDO #" + o.order_number, dateTime(o.created_at),
      o.fulfilment === "delivery" ? "A DOMICILIO - " + (ZONES[o.zone] || o.zone) : o.fulfilment === "dine_in" ? "MESA " + o.table_number : "PARA RECOGER",
      "Cliente: " + o.customer_name, "Tel: " + o.phone];
    if (o.address) L.push("Dir: " + o.address);
    L.push("Pago: " + o.payment_method, "--------------------------------");
    (o.order_items || []).forEach(function (i) { L.push(i.quantity + " x " + i.product_name + "  " + money(i.line_total)); var d = P.describe(i.customizations || {}); if (d.length) L.push("   " + d.join(" / ")); });
    L.push("--------------------------------", "Productos: " + money(o.subtotal), "Envio: " + money(o.delivery_fee), "TOTAL: " + money(o.total));
    if (o.notes) L.push("NOTAS: " + o.notes);
    L.push("", "Gracias por tu pedido", "", "");
    return L;
  }
  function printTicket(o) {
    if (bt) {
      var data = new TextEncoder().encode("\x1B@" + ticketLines(o).join("\n").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/€/g, "EUR") + "\n\n\x1DVA0");
      var chain = Promise.resolve();
      for (var i = 0; i < data.length; i += 180) (function (chunk) { chain = chain.then(function () { return bt.properties.writeWithoutResponse ? bt.writeValueWithoutResponse(chunk) : bt.writeValue(chunk); }); })(data.slice(i, i + 180));
      return chain.then(function () { toast("Ticket enviado a la impresora"); }).catch(function (e) { toast("Fallo Bluetooth: " + e.message + ". Usa la impresión estándar.", true); bt = null; });
    }
    var w = window.open("", "_blank", "width=420,height=720");
    if (!w) return toast("Permite las ventanas emergentes para imprimir", true);
    var items = (o.order_items || []).map(function (i) { var d = P.describe(i.customizations || {}); return '<div class="it"><div class="ln"><span>' + i.quantity + " × " + esc(i.product_name) + "</span><b>" + money(i.line_total) + "</b></div>" + (d.length ? '<div class="op">' + esc(d.join(" · ")) + "</div>" : "") + "</div>"; }).join("");
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket #' + o.order_number + '</title><style>body{font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;width:72mm;margin:0 auto;padding:6px;color:#000}h1{font-size:17px;text-align:center;margin:0}p{margin:3px 0}.c{text-align:center}.r{border-top:1px dashed #000;margin:7px 0}.ln{display:flex;justify-content:space-between;gap:6px}.it{margin:5px 0}.op{font-size:11px;padding-left:8px}.big{font-size:20px;font-weight:bold;text-align:center;margin:6px 0}.t{font-size:16px;font-weight:bold}@page{size:80mm auto;margin:3mm}@media print{.np{display:none}}</style></head><body>' +
      "<h1>TELE KEBAB PIZZERÍA</h1><p class=c>Ctra. de Sentmenat 68–72, local 4<br>Castellar del Vallès · 937 47 46 96</p><div class=r></div><div class=big>#" + o.order_number + "</div><p class=c><b>" + (o.fulfilment === "delivery" ? "A DOMICILIO" : o.fulfilment === "dine_in" ? "MESA " + esc(o.table_number) : "PARA RECOGER") + "</b><br>" + esc(dateTime(o.created_at)) + "</p><div class=r></div>" +
      "<p><b>" + esc(o.customer_name) + "</b> · " + esc(o.phone) + "</p>" + (o.address ? "<p>" + esc(o.address) + "<br>" + esc(ZONES[o.zone] || "") + "</p>" : "") + "<p>Pago: " + esc(o.payment_method) + "</p><div class=r></div>" + items + "<div class=r></div>" +
      '<div class=ln><span>Productos</span><span>' + money(o.subtotal) + '</span></div><div class=ln><span>Envío</span><span>' + money(o.delivery_fee) + '</span></div><div class="ln t"><span>TOTAL</span><span>' + money(o.total) + "</span></div>" +
      (o.notes ? "<div class=r></div><p><b>Notas:</b> " + esc(o.notes) + "</p>" : "") + '<div class=r></div><p class=c>¡Gracias por tu pedido!</p><button class=np onclick="print()" style="width:100%;padding:10px;margin-top:10px">Imprimir</button><script>onload=function(){setTimeout(print,250)}<\/script></body></html>');
    w.document.close();
  }

  /* ---------- Carta ---------- */
  var sold30 = {};
  function loadProducts() {
    return api("admin-menu").then(function (d) { S.products = d.products || []; if (S.view === "carta" || S.view === "asistente") render(); })
      .catch(function (e) { toast("No se pudo cargar la carta: " + e.message, true); });
  }
  function famList() { var f = []; S.products.forEach(function (p) { if (f.indexOf(p.family || "Otros") < 0) f.push(p.family || "Otros"); }); return f.sort(); }
  function renderProducts() {
    sold30 = {}; recent(mergeOrders(), 30).forEach(function (o) { if (o.status === "cancelado") return; (o.order_items || []).forEach(function (i) { sold30[i.product_name] = (sold30[i.product_name] || 0) + Number(i.quantity || 0); }); });
    var fs = $("#prodFamily"), cur = fs.value;
    fs.innerHTML = '<option value="">Todas las familias</option>' + famList().map(function (f) { return "<option>" + esc(f) + "</option>"; }).join(""); fs.value = cur;
    $("#famStrip").innerHTML = famList().map(function (f) { var ps = S.products.filter(function (p) { return (p.family || "Otros") === f; }); return '<span class="fam-chip"><b>' + esc(f) + "</b> " + ps.filter(function (p) { return p.active; }).length + "/" + ps.length + "</span>"; }).join("");
    var q = $("#prodSearch").value.trim().toLowerCase(), fam = fs.value, st = $("#prodState").value;
    var rows = S.products.filter(function (p) {
      return (!fam || (p.family || "Otros") === fam) && (!q || (p.name + " " + p.category + " " + p.family).toLowerCase().indexOf(q) >= 0) &&
        (!st || (st === "on" && p.active) || (st === "off" && !p.active) || (st === "review" && p.source_status && p.source_status !== "legacy"));
    });
    var editable = can("menu_edit"), stock = can("stock") || editable;
    $("#prodTable tbody").innerHTML = rows.map(function (p) {
      var c = p.customization_config || {}, price = P.hasVariablePrice(p) ? "desde " + money(P.fromPrice(p)) : money(p.price);
      return '<tr data-id="' + esc(p.id) + '"><td><div class="p-name"><span class="p-thumb">' + (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="">' : esc(p.emoji || "🍽️")) + "</span><span><b>" + esc(p.name) + "</b>" + (p.source_status && p.source_status !== "legacy" ? "<small>Pendiente de revisar</small>" : "") + "</span></div></td>" +
        "<td>" + esc(p.family || "Otros") + ' <span class="muted">· ' + esc(p.category) + "</span></td>" +
        '<td class="num">' + price + (c.size_required ? "" : "") + '</td><td class="num">' + (sold30[p.name] || "—") + "</td>" +
        '<td><button class="toggle" role="switch" aria-checked="' + !!p.active + '" aria-label="Disponible en la web" data-toggle' + (stock ? "" : " disabled") + "></button></td>" +
        "<td>" + (editable ? '<button class="btn btn-ghost btn-sm" data-edit>Editar</button>' : "") + "</td></tr>";
    }).join("") || '<tr><td colspan="6"><div class="empty">Sin productos con estos filtros.</div></td></tr>';
  }
  ["#prodSearch", "#prodFamily", "#prodState"].forEach(function (s) { $(s).addEventListener("input", renderProducts); });
  $("#prodTable").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]"); if (!tr) return;
    var p = S.products.filter(function (x) { return x.id === tr.dataset.id; })[0]; if (!p) return;
    if (e.target.closest("[data-toggle]")) {
      var b = e.target.closest("[data-toggle]"); b.disabled = true;
      saveProduct(Object.assign({}, p, { active: !p.active })).then(function (np) { if (np) toast(np.active ? "«" + np.name + "» visible en la web" : "«" + np.name + "» oculto (agotado)"); }).then(function () { b.disabled = false; });
      return;
    }
    if (e.target.closest("[data-edit]")) openProduct(p);
  });
  $("#newProduct").addEventListener("click", function () { openProduct({ name: "", family: $("#prodFamily").value || "", category: "", price: 0, sort_order: 100, emoji: "🍽️", description: "", active: false, customization_config: {}, source_status: "legacy", source_note: "" }); });

  function productBody(p) {
    return { id: p.id || undefined, name: p.name, family: p.family || "Otros", category: p.category, price: Number(p.price), sort_order: Number(p.sort_order == null ? 100 : p.sort_order), emoji: p.emoji || "🍽️", description: p.description || "", customization_config: p.customization_config || {}, source_status: p.source_status || "legacy", source_note: p.source_note || "", active: !!p.active, image_url: p.image_url === undefined ? undefined : p.image_url };
  }
  function saveProduct(p) {
    var body = productBody(p);
    return api("admin-menu", body).then(function (d) {
      var np = d.product || body;
      // El servidor actual (v2) ignora familia, orden y personalización: lo detectamos y avisamos.
      var lost = [];
      if (np.family !== undefined && np.family !== body.family) lost.push("familia");
      if (np.sort_order !== undefined && Number(np.sort_order) !== body.sort_order) lost.push("orden");
      if (np.customization_config !== undefined && JSON.stringify(np.customization_config || {}) !== JSON.stringify(body.customization_config)) lost.push("personalización");
      if (lost.length) { S.features.menuFull = false; banner("warn", "El servidor actual sólo ha guardado nombre, categoría, precio, descripción y disponibilidad. <b>No se han guardado: " + lost.join(", ") + "</b>. Se corrige al activar la actualización de <code>admin-menu</code> pendiente de autorización."); }
      else if (body.id) S.features.menuFull = true;
      var i = S.products.findIndex(function (x) { return x.id === np.id; });
      if (i >= 0) S.products[i] = np; else S.products.push(np);
      renderProducts();
      return np;
    }).catch(function (e) { toast("No se pudo guardar: " + e.message, true); return null; });
  }
  function banner(kind, html) { $("#banner").innerHTML = notice(kind, html); }

  // Editor de producto: campos guiados + JSON avanzado sincronizado.
  function openProduct(p) {
    var c = JSON.parse(JSON.stringify(p.customization_config || {}));
    var fams = famList();
    var h = '<form id="pf" novalidate>' +
      '<div class="grid3"><div class="field"><label>Nombre</label><input class="input" name="name" maxlength="100" required value="' + esc(p.name) + '"></div><div class="field"><label>Precio base (€)</label><input class="input" name="price" type="number" step="0.01" min="0" max="1000" value="' + esc(p.price) + '"></div><div class="field"><label>Emoji</label><input class="input" name="emoji" maxlength="8" value="' + esc(p.emoji || "🍽️") + '"></div></div>' +
      '<div class="grid3"><div class="field"><label>Familia</label><input class="input" name="family" list="famOpts" maxlength="60" value="' + esc(p.family || "") + '"><datalist id="famOpts">' + fams.map(function (f) { return "<option>" + esc(f) + "</option>"; }).join("") + '</datalist></div><div class="field"><label>Categoría</label><input class="input" name="category" maxlength="60" value="' + esc(p.category || "") + '"></div><div class="field"><label>Orden</label><input class="input" name="sort_order" type="number" min="0" max="9999" value="' + esc(p.sort_order == null ? 100 : p.sort_order) + '"></div></div>' +
      '<div class="field"><label>Descripción <button type="button" class="btn btn-ghost btn-sm" id="suggestDesc" style="margin-left:8px">✨ Sugerir descripción</button></label><textarea class="input" name="description" maxlength="300" rows="2">' + esc(p.description || "") + "</textarea></div>" +
      '<div class="field"><label>Foto</label><div style="display:flex;gap:10px;align-items:center"><span class="p-thumb" id="pfThumb" style="width:56px;height:56px">' + (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="">' : esc(p.emoji || "🍽️")) + '</span><input type="file" id="pfFile" accept="image/webp,image/jpeg,image/png,image/avif" class="input"></div><small class="muted" id="pfFileMsg">JPG, PNG o WebP de hasta 3 MB. Usa fotos reales del producto.</small></div>' +
      '<label class="switch-line"><input type="checkbox" name="active"' + (p.active ? " checked" : "") + '> <span><b>Disponible en la web</b></span></label>' +
      '<fieldset><legend>Tamaños</legend><label class="check"><input type="checkbox" id="cSizeReq"' + (c.size_required ? " checked" : "") + '> El cliente debe elegir tamaño (el precio lo marca el tamaño)</label><div id="sizeRows"></div><button type="button" class="btn btn-ghost btn-sm" id="addSize">+ Tamaño</button></fieldset>' +
      '<fieldset><legend>Opciones</legend>' +
      '<div class="field"><label>Carnes (separadas por comas)</label><input class="input" id="cMeat" value="' + esc((c.meat_options || []).join(", ")) + '"></div><label class="check"><input type="checkbox" id="cMeatReq"' + (c.meat_required ? " checked" : "") + "> Carne obligatoria</label>" +
      '<div class="field"><label>Acompañamientos (comas)</label><input class="input" id="cSide" value="' + esc((c.side_options || []).join(", ")) + '"></div><label class="check"><input type="checkbox" id="cSideReq"' + (c.side_required ? " checked" : "") + "> Acompañamiento obligatorio</label>" +
      '<div class="field"><label>Salsa a elegir (comas)</label><input class="input" id="cSauce" value="' + esc((c.sauce_choice_options || []).join(", ")) + '"></div>' +
      '<label class="check"><input type="checkbox" id="cDrink"' + (c.drink_required ? " checked" : "") + "> Es un menú: el cliente elige bebida (pequeña incluida)</label></fieldset>" +
      '<fieldset><legend>Extras y cambios</legend><div class="grid2"><div class="field"><label>Salsas extra (comas)</label><input class="input" id="cExSauce" value="' + esc((c.extra_sauce_options || []).join(", ")) + '"></div><div class="field"><label>Precio por salsa extra</label><input class="input" id="cExSaucePrice" type="number" step="0.05" min="0" value="' + esc(c.extra_sauce_price == null ? "" : c.extra_sauce_price) + '"></div></div>' +
      '<label class="check"><input type="checkbox" id="cExIng"' + (c.allow_extra_ingredients ? " checked" : "") + '> Permite añadir ingredientes</label><div class="grid2"><div class="field"><label>Ingredientes que se pueden añadir (comas; vacío = lista estándar)</label><input class="input" id="cExIngOpts" value="' + esc((c.extra_ingredient_options || []).join(", ")) + '"></div><div class="field"><label>Precio por ingrediente</label><input class="input" id="cExIngPrice" type="number" step="0.05" min="0" value="' + esc(c.extra_ingredient_price == null ? "" : c.extra_ingredient_price) + '"></div></div>' +
      '<div class="field"><label>Precio queso extra (vacío = no se ofrece)</label><input class="input" id="cCheese" type="number" step="0.05" min="0" value="' + esc(c.extra_cheese_price == null ? "" : c.extra_cheese_price) + '"></div>' +
      '<label class="check"><input type="checkbox" id="cRem"' + (c.allow_removals ? " checked" : "") + '> Permite quitar ingredientes</label><div class="field"><label>Ingredientes que se pueden quitar (comas)</label><input class="input" id="cIng" value="' + esc((c.ingredients || []).join(", ")) + '"></div></fieldset>' +
      '<div class="grid2"><div class="field"><label>Estado de revisión</label><select class="input" name="source_status">' + [["legacy", "Revisado"], ["preliminary", "Precio/composición provisional"], ["size_price_preliminary", "Tamaños y precios por validar"], ["price_confirmed_size_pending", "Precio confirmado, formato pendiente"]].map(function (o) { return '<option value="' + o[0] + '"' + (p.source_status === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></div><div class="field"><label>Nota interna</label><input class="input" name="source_note" maxlength="800" value="' + esc(p.source_note || "") + '"></div></div>' +
      '<details><summary>Configuración avanzada (JSON)</summary><textarea class="input" id="cJson" rows="10" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.82rem"></textarea><small class="muted">Incluye opciones de ofertas (unidades, sabores de pizza, bebidas). Si editas aquí, los campos de arriba se actualizan al salir del cuadro.</small></details>' +
      '<div id="pfMsg"></div></form>';
    openSheet(p.id ? "Editar · " + p.name : "Nuevo producto", h, '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-fire" id="pfSave">Guardar</button>');
    var form = $("#pf"), imageUrl = p.image_url;
    function sizeRows() { $("#sizeRows").innerHTML = (c.sizes || []).map(function (s, i) { return '<div class="size-row"><input class="input" data-sn="' + i + '" value="' + esc(s.name) + '" placeholder="Nombre (p. ej. Familiar 36 cm)"><input class="input" data-sp="' + i + '" type="number" step="0.01" min="0" value="' + esc(s.price) + '"><button type="button" class="icon-btn" data-sdel="' + i + '" aria-label="Quitar tamaño">×</button></div>'; }).join(""); }
    var csv = function (id) { return $(id).value.split(",").map(function (x) { return x.trim(); }).filter(Boolean); };
    var num = function (id) { var v = $(id).value; return v === "" ? null : Number(v); };
    function collect() {
      var set = function (k, v) { if (v == null || (Array.isArray(v) && !v.length) || v === false) delete c[k]; else c[k] = v; };
      c.sizes = $$("#sizeRows .size-row").map(function (r, i) { return { name: $('[data-sn="' + i + '"]', r).value.trim(), price: Number($('[data-sp="' + i + '"]', r).value) }; }).filter(function (s) { return s.name; });
      if (!c.sizes.length) delete c.sizes;
      set("size_required", $("#cSizeReq").checked); set("meat_options", csv("#cMeat")); set("meat_required", $("#cMeatReq").checked);
      set("side_options", csv("#cSide")); set("side_required", $("#cSideReq").checked); set("sauce_choice_options", csv("#cSauce"));
      set("drink_required", $("#cDrink").checked); if ($("#cDrink").checked) c.drink_included = true;
      set("extra_sauce_options", csv("#cExSauce")); set("extra_sauce_price", num("#cExSaucePrice"));
      set("allow_extra_ingredients", $("#cExIng").checked); set("extra_ingredient_options", csv("#cExIngOpts")); set("extra_ingredient_price", num("#cExIngPrice"));
      set("extra_cheese_price", num("#cCheese")); set("allow_removals", $("#cRem").checked); set("ingredients", csv("#cIng"));
      $("#cJson").value = JSON.stringify(c, null, 2);
    }
    sizeRows(); collect();
    form.addEventListener("input", function (e) { if (e.target.id !== "cJson") collect(); });
    form.addEventListener("change", function (e) { if (e.target.id !== "cJson") collect(); });
    $("#addSize").addEventListener("click", function () { collect(); c.sizes = (c.sizes || []).concat([{ name: "", price: 0 }]); sizeRows(); });
    $("#sizeRows").addEventListener("click", function (e) { var d = e.target.closest("[data-sdel]"); if (!d) return; collect(); c.sizes.splice(+d.dataset.sdel, 1); sizeRows(); collect(); });
    $("#cJson").addEventListener("blur", function () {
      try { var j = JSON.parse(this.value || "{}"); if (!j || typeof j !== "object" || Array.isArray(j)) throw 0; c = j; var keep = $("#pf").outerHTML; void keep; openProductKeep(); } catch (_) { $("#pfMsg").innerHTML = notice("err", "El JSON no es válido."); }
      function openProductKeep() { var cur = readForm(); cur.customization_config = c; openProduct(cur); $("details").open = true; }
    });
    $("#suggestDesc").addEventListener("click", function () { collect(); var cur = readForm(); form.description.value = I.describeProduct(cur); toast("Descripción sugerida a partir de los datos del producto. Revísala antes de guardar."); });
    $("#pfFile").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { $("#pfFileMsg").textContent = "La foto supera 3 MB."; return; }
      $("#pfFileMsg").textContent = "Subiendo…";
      api("admin-menu", { action: "upload_url", filename: f.name }).then(function (d) {
        return client.storage.from("product-images").uploadToSignedUrl(d.path, d.token, f, { contentType: f.type }).then(function (r) {
          if (r.error) throw r.error;
          imageUrl = d.public_url; $("#pfThumb").innerHTML = '<img src="' + esc(imageUrl) + '" alt="">'; $("#pfFileMsg").textContent = "Foto subida. Pulsa «Guardar» para aplicarla.";
        });
      }).catch(function (e) { $("#pfFileMsg").textContent = notDeployed(e) || e.status === 503 ? "La subida de fotos se activa con la actualización del servidor pendiente de autorizar." : "No se pudo subir: " + e.message; });
    });
    function readForm() {
      return { id: p.id, name: form.name.value.trim(), price: form.price.value, emoji: form.emoji.value, family: form.family.value.trim() || "Otros", category: form.category.value.trim(), sort_order: form.sort_order.value, description: form.description.value.trim(), active: form.active.checked, source_status: form.source_status.value, source_note: form.source_note.value, customization_config: c, image_url: imageUrl };
    }
    $("#pfSave").addEventListener("click", function () {
      collect();
      var cur = readForm(), errs = [];
      if (!cur.name) errs.push("Falta el nombre.");
      if (!cur.category) errs.push("Falta la categoría.");
      if (!(Number(cur.price) >= 0) || cur.price === "") errs.push("Precio no válido.");
      if (c.size_required && !(c.sizes || []).length) errs.push("Has marcado tamaño obligatorio pero no hay tamaños.");
      (c.sizes || []).forEach(function (s) { if (!(s.price >= 0)) errs.push("Precio de tamaño no válido: " + s.name); });
      if (errs.length) { $("#pfMsg").innerHTML = notice("err", errs.join("<br>")); return; }
      var btn = this; btn.disabled = true; btn.textContent = "Guardando…";
      saveProduct(cur).then(function (np) { btn.disabled = false; btn.textContent = "Guardar"; if (np) { closeSheet(); toast("Producto guardado"); } });
    });
  }

  /* ---------- Equipo ---------- */
  function renderTeam() {
    $("#roleTable").innerHTML = "<thead><tr><th>Permiso</th>" + ["owner", "manager", "staff"].map(function (r) { return "<th>" + ROLE_LABEL[r] + "</th>"; }).join("") + "</tr></thead><tbody>" +
      Object.keys(PERM_LABEL).map(function (k) { return "<tr><td>" + PERM_LABEL[k] + "</td>" + ["owner", "manager", "staff"].map(function (r) { return ROLE_DEFAULTS[r].indexOf(k) >= 0 ? '<td class="yes">✓</td>' : '<td class="no">—</td>'; }).join("") + "</tr>"; }).join("") + "</tbody>";
    if (S.features.staff === false) return pendingTeam();
    $("#staffList").innerHTML = '<div class="empty">Cargando equipo…</div>';
    api("admin-staff", { action: "list" }).then(function (d) {
      S.features.staff = true; S.staff = d.staff || [];
      $("#newStaff").disabled = false;
      $("#staffList").innerHTML = S.staff.map(function (s) {
        return '<div class="staff' + (s.active ? "" : " off") + '" data-uid="' + esc(s.user_id) + '"><span class="avatar">' + esc((s.display_name || s.email).charAt(0).toUpperCase()) + "</span><div><b>" + esc(s.display_name) + (s.user_id === d.me ? ' <span class="badge">Tú</span>' : "") + "</b><small>" + esc(s.email) + " · " + (s.last_sign_in_at ? "último acceso " + dateTime(s.last_sign_in_at) : "sin accesos") + '</small></div><span class="badge">' + esc(ROLE_LABEL[s.role] || s.role) + (s.active ? "" : " · desactivado") + '</span><button class="btn btn-ghost btn-sm" data-staff-edit>Editar</button></div>';
      }).join("");
    }).catch(function (e) { if (notDeployed(e)) { S.features.staff = false; pendingTeam(); } else $("#staffList").innerHTML = notice("err", esc(e.message)); });
  }
  function pendingTeam() {
    $("#newStaff").disabled = true;
    $("#staffList").innerHTML = notice("info", "<b>Gestión de trabajadores pendiente de activación.</b> Requiere desplegar la función <code>admin-staff</code> y la migración de perfiles (preparadas, sin publicar). Hasta entonces, las cuentas se crean desde Supabase. Cuentas con acceso hoy: 2 (ambas con rol de propietario).");
  }
  function permChecks(role, overrides) {
    var eff = ROLE_DEFAULTS[role].slice();
    Object.keys(overrides || {}).forEach(function (k) { if (overrides[k] === true && eff.indexOf(k) < 0) eff.push(k); if (overrides[k] === false) eff = eff.filter(function (x) { return x !== k; }); });
    return Object.keys(PERM_LABEL).map(function (k) { var lock = role === "owner" || k === "staff_manage" || k === "settings"; return '<label class="check"><input type="checkbox" data-perm-k="' + k + '"' + (eff.indexOf(k) >= 0 ? " checked" : "") + (lock ? " disabled" : "") + "> " + PERM_LABEL[k] + "</label>"; }).join("");
  }
  function readPerms(role) {
    var o = {}; $$("[data-perm-k]").forEach(function (cb) { var k = cb.dataset.permK, def = ROLE_DEFAULTS[role].indexOf(k) >= 0; if (!cb.disabled && cb.checked !== def) o[k] = cb.checked; }); return o;
  }
  function genPass() { var a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = new Uint32Array(14); crypto.getRandomValues(r); return Array.prototype.map.call(r, function (x) { return a[x % a.length]; }).join(""); }
  $("#newStaff").addEventListener("click", function () {
    var pass = genPass();
    openSheet("Añadir trabajador", '<div class="grid2"><div class="field"><label>Nombre visible</label><input class="input" id="sfName" maxlength="60" placeholder="Ej.: Ahmed (cocina)"></div><div class="field"><label>Correo</label><input class="input" id="sfEmail" type="email" autocomplete="off"></div></div>' +
      '<div class="grid2"><div class="field"><label>Rol</label><select class="input" id="sfRole"><option value="staff">Cocina / reparto</option><option value="manager">Encargado</option><option value="owner">Propietario</option></select></div><div class="field"><label>Contraseña inicial</label><input class="input" id="sfPass" value="' + pass + '"></div></div>' +
      notice("info", "Entrégale la contraseña en persona. Podrá usarla en el tablero de cocina y en este panel.") + "<fieldset><legend>Permisos</legend><div id=\"sfPerms\">" + permChecks("staff", {}) + "</div></fieldset><div id=\"sfMsg\"></div>",
      '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-fire" id="sfSave">Crear acceso</button>');
    $("#sfRole").addEventListener("change", function () { $("#sfPerms").innerHTML = permChecks(this.value, {}); });
    $("#sfSave").addEventListener("click", function () {
      var b = this, role = $("#sfRole").value; b.disabled = true;
      api("admin-staff", { action: "create", display_name: $("#sfName").value, email: $("#sfEmail").value, password: $("#sfPass").value, role: role, permissions: readPerms(role) })
        .then(function () { closeSheet(); toast("Acceso creado"); renderTeam(); }).catch(function (e) { $("#sfMsg").innerHTML = notice("err", esc(e.message)); b.disabled = false; });
    });
  });
  $("#staffList").addEventListener("click", function (e) {
    if (!e.target.closest("[data-staff-edit]")) return;
    var s = S.staff.filter(function (x) { return x.user_id === e.target.closest("[data-uid]").dataset.uid; })[0]; if (!s) return;
    openSheet("Editar · " + s.display_name, '<div class="grid2"><div class="field"><label>Nombre visible</label><input class="input" id="seName" value="' + esc(s.display_name) + '"></div><div class="field"><label>Rol</label><select class="input" id="seRole">' + ["staff", "manager", "owner"].map(function (r) { return '<option value="' + r + '"' + (s.role === r ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>"; }).join("") + "</select></div></div>" +
      "<fieldset><legend>Permisos</legend><div id=\"sePerms\">" + permChecks(s.role, s.permissions) + "</div></fieldset>" +
      '<label class="switch-line"><input type="checkbox" id="seActive"' + (s.active ? " checked" : "") + '> <span><b>Acceso activo</b><br><small class="muted">Desactivar bloquea el inicio de sesión al momento. Su historial se conserva.</small></span></label>' +
      '<div class="field"><label>Nueva contraseña (opcional)</label><input class="input" id="sePass" placeholder="Mínimo 10 caracteres"></div><div id="seMsg"></div>',
      '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-fire" id="seSave">Guardar</button>');
    $("#seRole").addEventListener("change", function () { $("#sePerms").innerHTML = permChecks(this.value, {}); });
    $("#seSave").addEventListener("click", function () {
      var b = this, role = $("#seRole").value, patch = { display_name: $("#seName").value, role: role, permissions: readPerms(role), active: $("#seActive").checked };
      if ($("#sePass").value) patch.password = $("#sePass").value;
      b.disabled = true;
      api("admin-staff", { action: "update", user_id: s.user_id, patch: patch }).then(function () { closeSheet(); toast("Cambios guardados"); renderTeam(); }).catch(function (e) { $("#seMsg").innerHTML = notice("err", esc(e.message)); b.disabled = false; });
    });
  });

  /* ---------- Asistente ---------- */
  $("#aiRange").addEventListener("change", function () { loadHistory(Number(this.value)).then(renderAssistant); });
  function renderAssistant() {
    var days = Number($("#aiRange").value), orders = recent(mergeOrders(), days);
    var s = I.salesSummary(orders, days);
    $("#aiSales").innerHTML = s.text.map(function (t) { return '<div class="insight">' + t + "</div>"; }).join("");
    var t = I.timing(orders);
    var max = 1; t.grid.forEach(function (row) { Object.keys(row).forEach(function (h) { max = Math.max(max, row[h]); }); });
    var hours = []; for (var hh = 11; hh <= 23; hh++) hours.push(hh);
    $("#aiTimes").innerHTML = t.text.map(function (x) { return '<div class="insight">' + x + "</div>"; }).join("") +
      (t.enough ? '<div class="small muted" style="margin-top:10px">Pedidos por día y hora (más intenso = más pedidos)</div>' + ["L", "M", "X", "J", "V", "S", "D"].map(function (d, i) {
        return '<div style="display:grid;grid-template-columns:16px 1fr;gap:6px;align-items:center"><span class="small muted">' + d + '</span><div class="heat" style="margin-top:3px">' + hours.map(function (h) { var v = t.grid[i][h] || 0; return '<div title="' + d + " " + h + ":00 · " + v + ' pedidos" style="background:' + (v ? "rgba(255,90,31," + (0.18 + 0.82 * v / max).toFixed(2) + ")" : "") + '"></div>'; }).join("") + "</div></div>";
      }).join("") + '<div style="display:grid;grid-template-columns:16px 1fr;gap:6px"><span></span><div class="heat-l">' + hours.map(function (h) { return "<span>" + h + "</span>"; }).join("") + "</div></div>" : "");
    var pr = I.pairs(orders, 6);
    $("#aiPairs").innerHTML = !pr.enough ? '<div class="insight">Se necesitan más pedidos para detectar combinaciones.</div>' : pr.pairs.length ? I.promoIdeas(pr.pairs, S.products).map(function (x) { return '<div class="insight">' + x.text + '<br><span class="muted">' + x.idea + "</span></div>"; }).join("") + '<p class="muted small">Ideas basadas en tus pedidos. Tú decides precio y condiciones; el asistente no crea promociones por su cuenta.</p>' : '<div class="insight">No hay productos que se repitan juntos al menos 2 veces en este periodo.</div>';
    var sold = {}; recent(mergeOrders(), 30).forEach(function (o) { if (o.status !== "cancelado") (o.order_items || []).forEach(function (i) { sold[i.product_name] = (sold[i.product_name] || 0) + Number(i.quantity); }); });
    var au = I.audit(S.products, sold);
    $("#aiAudit").innerHTML = au.length ? au.slice(0, 14).map(function (x) { return '<div class="insight"><span class="tag">' + esc(x.tag) + "</span>" + x.text + "</div>"; }).join("") : '<div class="insight">La carta no presenta incidencias.</div>';
  }

  /* ---------- Ajustes ---------- */
  function renderSettings() {
    var B = P.BUSINESS;
    $("#bizData").innerHTML = [["Nombre", B.name], ["Dirección", B.address + ", " + B.postalTown], ["Teléfono", B.phone], ["Modalidades", "A domicilio y recogida (y en mesa mediante QR)"], ["Pago", "Efectivo o tarjeta al recibir / recoger"]].map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    $("#zonesTable").innerHTML = "<thead><tr><th>Zona</th><th class=num>Envío</th><th class=num>Mínimo</th></tr></thead><tbody>" + P.ZONES.map(function (z) { return "<tr><td>" + esc(z.name) + "</td><td class=num>" + money(z.fee) + "</td><td class=num>" + money(z.minimum) + "</td></tr>"; }).join("") + "<tr><td>Recogida</td><td class=num>Gratis</td><td class=num>—</td></tr></tbody>";
    var fill = function (v) {
      var hours = (v && v.hours) || B.hours;
      $("#hoursRows").innerHTML = hours.map(function (h, i) { return '<div class="size-row" style="grid-template-columns:1fr 1fr 38px"><input class="input" type="time" data-hf="' + i + '" value="' + esc(h.from) + '"><input class="input" type="time" data-ht="' + i + '" value="' + esc(h.to) + '"><button type="button" class="icon-btn" data-hdel="' + i + '" aria-label="Quitar turno">×</button></div>'; }).join("");
      $("#announcement").value = (v && v.announcement) || ""; $("#paused").checked = !!(v && v.ordering_paused);
    };
    if (S.features.settings === false) { fill(null); return pendingSettings(); }
    api("admin-settings").then(function (d) { S.features.settings = true; fill(d.settings); $("#settingsMsg").innerHTML = d.updated_at ? '<p class="muted small">Última modificación: ' + dateTime(d.updated_at) + "</p>" : ""; })
      .catch(function (e) { if (notDeployed(e)) { S.features.settings = false; fill(null); pendingSettings(); } else $("#settingsMsg").innerHTML = notice("err", esc(e.message)); });
  }
  function pendingSettings() {
    $$("#settingsForm input, #settingsForm button").forEach(function (x) { x.disabled = true; });
    $("#settingsMsg").innerHTML = notice("info", "<b>Edición pendiente de activación.</b> Requiere la tabla <code>site_settings</code> y la función <code>admin-settings</code> (preparadas, sin publicar). Mientras tanto la web usa el horario 11:30–16:00 y 18:00–23:00.");
  }
  $("#addHours").addEventListener("click", function () { var n = $$("#hoursRows .size-row").length; $("#hoursRows").insertAdjacentHTML("beforeend", '<div class="size-row" style="grid-template-columns:1fr 1fr 38px"><input class="input" type="time" data-hf="' + n + '" value="18:00"><input class="input" type="time" data-ht="' + n + '" value="23:00"><button type="button" class="icon-btn" data-hdel="' + n + '">×</button></div>'); });
  $("#hoursRows").addEventListener("click", function (e) { var d = e.target.closest("[data-hdel]"); if (d) d.parentElement.remove(); });
  $("#settingsForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var hours = $$("#hoursRows .size-row").map(function (r) { return { from: $("[data-hf]", r).value, to: $("[data-ht]", r).value }; });
    if (!hours.length || hours.some(function (h) { return !h.from || !h.to || h.from >= h.to; })) { $("#settingsMsg").innerHTML = notice("err", "Revisa el horario: cada turno debe empezar antes de terminar."); return; }
    api("admin-settings", { settings: { hours: hours, announcement: $("#announcement").value, ordering_paused: $("#paused").checked } })
      .then(function () { $("#settingsMsg").innerHTML = notice("ok", "Ajustes guardados. Ya se ven en la web."); })
      .catch(function (err) { $("#settingsMsg").innerHTML = notice("err", esc(err.message)); });
  });

  /* ---------- Hoja lateral ---------- */
  function openSheet(title, body, foot) {
    $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = body; $("#sheetFoot").innerHTML = foot || '<button class="btn btn-ghost" data-close>Cerrar</button>';
    $("#sheetFoot").classList.toggle("hidden", foot === "");
    $("#sheet").classList.add("open"); $("#sheet").setAttribute("aria-hidden", "false"); $("#scrim").classList.add("open");
  }
  function closeSheet() { $("#sheet").classList.remove("open"); $("#sheet").setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("open"); }
  document.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeSheet(); });
  $("#scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  /* ---------- Arranque ---------- */
  client.auth.getSession().then(function (r) {
    S.session = r.data && r.data.session;
    if (S.session) start(); else showLogin();
  });
  client.auth.onAuthStateChange(function (_ev, session) { if (session) S.session = session; });
  window.__tkAdmin = S;
})();
