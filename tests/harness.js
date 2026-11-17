/*
 * Arnés de pruebas E2E: sirve la web local y simula Supabase.
 *  - La carta se sirve desde tests/fixtures/products.json (copia real de producción, sólo lectura).
 *  - create-order usa el port fiel de la lógica del servidor (tests/server-port.js).
 *  - NINGUNA petición sale hacia Supabase de producción: no se crean pedidos reales.
 */
"use strict";
const { createOrder } = require("./server-port.js");
const products = require("./fixtures/products.json").map((p) => ({ ...p, price: Number(p.price), active: true }));

const SUPA = "https://zifzljhewpimjjulbyqx.supabase.co";

function makeState() {
  return { orders: [], nextNumber: 1201, calls: [], staffRole: "owner", products: JSON.parse(JSON.stringify(products)), events: [], staff: [
    { user_id: "u-owner", email: "propietario@telekebab.test", display_name: "Propietario", role: "owner", active: true, permissions: {} },
    { user_id: "u-staff", email: "cocina@telekebab.test", display_name: "Cocina", role: "staff", active: true, permissions: { orders: true, stock: true } }
  ], settings: null };
}

async function install(page, state) {
  // Fija la hora: 13:00 en Barcelona (abierto) salvo que el test diga otra cosa.
  await page.route(SUPA + "/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    let body = null; try { body = req.postDataJSON(); } catch (_) {}
    state.calls.push({ path, method: req.method(), body });

    if (path === "/rest/v1/products") return json(200, state.products.filter((p) => p.active));
    if (path === "/rest/v1/site_settings") return json(404, { message: "relation does not exist" });
    if (path === "/auth/v1/token") {
      const email = body && body.email;
      const user = state.staff.find((s) => s.email === email);
      if (!user || body.password !== "correcta") return json(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
      state.staffRole = user.role; state.currentUser = user;
      return json(200, { access_token: "test-token-" + user.role, token_type: "bearer", expires_in: 864000, expires_at: Math.floor(Date.now() / 1000) + 864000, refresh_token: "r", user: { id: user.user_id, email: user.email, aud: "authenticated", role: "authenticated" } });
    }
    if (path === "/auth/v1/logout") return json(204, {});
    if (path === "/auth/v1/user") return json(200, { id: state.currentUser?.user_id, email: state.currentUser?.email });
    if (path.startsWith("/realtime")) return route.abort();

    const fn = path.replace("/functions/v1/", "");
    const isOwner = state.staffRole === "owner";
    switch (fn) {
      case "create-order": {
        const [status, res] = createOrder(body, state.products);
        if (status !== 200) return json(status, res);
        const order = { id: "ord-" + state.nextNumber, order_number: state.nextNumber++, customer_name: body.customer_name, phone: body.phone, fulfilment: body.fulfilment, zone: body.zone, address: body.address, table_number: body.table_number, payment_method: body.payment_method, notes: body.notes, subtotal: res.subtotal, delivery_fee: res.fee, total: res.total, status: "nuevo", created_at: new Date().toISOString(), order_items: res.lines.map((l, i) => ({ id: "it" + i, ...l })) };
        state.orders.unshift(order);
        return json(200, { ok: true, order_number: order.order_number, total: order.total, table_number: order.table_number || null });
      }
      case "track-order": {
        const o = state.orders.find((x) => String(x.order_number) === String(body.order_number) && x.phone.replace(/\D/g, "") === String(body.phone).replace(/\D/g, ""));
        if (!o) return json(404, { ok: false, error: "No encontramos ese pedido con esos datos. Comprueba el número y el teléfono." });
        const labels = { nuevo: "Pedido recibido", aceptado: "Pedido aceptado", preparando: "En preparación", listo: "Pedido listo", en_reparto: "En reparto", completado: "Completado", cancelado: "Cancelado" };
        return json(200, { ok: true, order_number: o.order_number, status: o.status, status_label: labels[o.status], fulfilment: o.fulfilment, created_at: o.created_at });
      }
      case "admin-orders": {
        if (body && body.view === "events") return state.legacy ? json(200, { orders: state.orders }) : json(200, { events: state.events.slice().reverse().map((e) => ({ ...e, actor_name: e.by, to_status: e.status, created_at: new Date().toISOString(), orders: { order_number: (state.orders.find((o) => o.id === e.order_id) || {}).order_number } })) });
        if (body && body.view !== "operational" && !isOwner) return json(403, { error: "Sólo el propietario puede consultar el histórico" });
        if (body && body.view === "operational") {
          const day = body.date || new Date().toISOString().slice(0, 10);
          const list = state.orders.filter((o) => o.created_at.slice(0, 10) >= day || ["nuevo", "aceptado", "preparando", "listo", "en_reparto"].includes(o.status));
          return json(200, { orders: list, count: list.length });
        }
        const list = state.orders.filter((o) => (!body || !body.from || o.created_at.slice(0, 10) >= body.from) && (!body || !body.to || o.created_at.slice(0, 10) <= body.to));
        return json(200, { orders: list, count: list.length });
      }
      case "owner-analytics": {
        if (!isOwner) return json(403, { error: "Solo el propietario" });
        return json(200, { monthSales: 0, averageTicket: 0, orderCount: 0, topProducts: [] });
      }
      case "update-order-status": {
        const o = state.orders.find((x) => x.id === body.id);
        if (!o) return json(404, { error: "Pedido no encontrado" });
        if (body.expected_status && body.expected_status !== o.status) return json(409, { error: "Otro compañero ya cambió este pedido. Actualiza la pantalla." });
        o.status = body.status; state.events.push({ order_id: o.id, status: body.status, by: state.currentUser?.email });
        return json(200, { ok: true });
      }
      case "admin-menu": {
        if (!body || !Object.keys(body).length) return json(200, { products: state.products });
        if (!isOwner && Object.keys(body).some((k) => !["id", "active"].includes(k))) return json(403, { error: "Sin permisos" });
        const ex = state.products.find((p) => p.id === body.id);
        if (ex && state.legacy) { // servidor actual (v2): sólo guarda estos campos
          ["name", "category", "description", "emoji", "price", "active"].forEach((k) => { ex[k] = body[k]; });
          return json(200, { ok: true, product: ex });
        }
        if (ex) Object.assign(ex, body); else state.products.push({ ...body, id: "new-" + state.products.length });
        return json(200, { ok: true, product: ex || state.products[state.products.length - 1] });
      }
      case "admin-staff": {
        if (state.legacy) return json(404, { code: "NOT_FOUND", message: "Requested function was not found" });
        if (!isOwner) return json(403, { error: "Sólo el propietario gestiona trabajadores" });
        if (!body || body.action === "list") return json(200, { staff: state.staff });
        if (body.action === "create") { const u = { user_id: "u-" + state.staff.length, email: body.email, display_name: body.display_name, role: body.role, active: true, permissions: body.permissions || {} }; state.staff.push(u); return json(200, { ok: true, staff: u }); }
        if (body.action === "update") { const u = state.staff.find((s) => s.user_id === body.user_id); Object.assign(u, body.patch); return json(200, { ok: true, staff: u }); }
        return json(400, { error: "Acción no válida" });
      }
      case "admin-settings": {
        if (state.legacy) return json(404, { code: "NOT_FOUND", message: "Requested function was not found" });
        if (!isOwner) return json(403, { error: "Sólo el propietario" });
        if (body && body.settings) { state.settings = body.settings; return json(200, { ok: true, settings: state.settings }); }
        return json(200, { settings: state.settings });
      }
      case "whoami":
        if (state.legacy) return json(404, { code: "NOT_FOUND", message: "Requested function was not found" });
        {
          const DEF = { owner: ["orders_view", "orders_update", "orders_cancel", "stock", "menu_edit", "reports", "staff_manage", "settings"], manager: ["orders_view", "orders_update", "orders_cancel", "stock", "menu_edit", "reports"], staff: ["orders_view", "orders_update", "stock"] };
          let eff = DEF[state.staffRole].slice(); const ov = state.currentUser?.permissions || {};
          if (state.staffRole !== "owner") Object.keys(ov).forEach((k) => { if (ov[k] === true && !eff.includes(k)) eff.push(k); if (ov[k] === false) eff = eff.filter((x) => x !== k); });
          return json(200, { user_id: state.currentUser?.user_id, email: state.currentUser?.email, role: state.staffRole, display_name: state.currentUser?.display_name, permissions: eff });
        }
      case "sms-status": return json(404, { error: "no existe" });
      default: return json(404, { error: "Función no encontrada: " + fn });
    }
  });
  await page.route(/fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/, (r) => r.abort());
}

async function setMadridTime(page, hh, mm) {
  const d = new Date(Date.UTC(2026, 10, 17, hh - 1, mm)); // noviembre: Madrid = UTC+1
  await page.clock.setFixedTime(d);
}

module.exports = { install, makeState, setMadridTime, products };
