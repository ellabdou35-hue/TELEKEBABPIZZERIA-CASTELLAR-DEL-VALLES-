/* E2E del panel de administración y de los permisos por rol. Uso: node tests/e2e-admin.js [baseURL] */
"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./harness.js");
const { createOrder } = require("./server-port.js");
const BASE = process.argv[2] || "http://127.0.0.1:8080";
const OUT = __dirname + "/../docs/evidencias/";
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["OK", name]); console.log("  ✔", name); }
  catch (e) { results.push(["FALLO", name, e.message]); console.log("  ✘", name, "\n    ", e.message.split("\n")[0]); }
}

// Pedidos ficticios de prueba (nunca se envían a producción), repartidos en 20 días.
function seed(state, now) {
  const P = state.products, by = (n) => P.find((p) => p.name === n);
  const recipes = [
    [["Menú dürüm kebab", { meat_choice: "Pollo", menu_drink: "Coca-Cola" }], ["Patatas fritas", {}]],
    [["Margarita", { size: "Familiar 36 cm" }], ["Coca-Cola", {}]],
    [["Dürüm kebab", { meat_choice: "Ternera" }], ["Patatas fritas", {}]],
    [["Oferta 2 kebab/dürüm + patatas", { unit_choices: [{ style: "Dürüm kebab", meat: "Pollo" }, { style: "Kebab en pita", meat: "Mixta" }] }]],
    [["Taco francés", { meat_choice: "Pollo" }], ["Coca-Cola", {}]],
  ];
  const statuses = ["completado", "completado", "completado", "cancelado", "completado"];
  let k = 0;
  for (let d = 19; d >= 0; d--) {
    for (let j = 0; j < (d === 0 ? 3 : (d % 3) + 1); j++) {
      const r = recipes[k % recipes.length];
      const items = r.map(([n, c]) => ({ product_id: by(n).id, quantity: 2, customizations: c }));
      const body = { customer_name: "Prueba " + k, phone: "6000000" + String(k).padStart(2, "0"), fulfilment: k % 2 ? "delivery" : "pickup", zone: k % 2 ? "castellar" : "pickup", address: k % 2 ? "Carrer de Prova " + k : "", payment_method: "Efectivo", notes: k === 7 ? "Alergia a los frutos secos" : "", items };
      const [st, res] = createOrder(body, P);
      if (st !== 200) throw new Error(res.error);
      const created = new Date(now.getTime() - d * 864e5 - j * 3600e3);
      state.orders.unshift({ id: "seed-" + k, order_number: 1000 + k, ...body, subtotal: res.subtotal, delivery_fee: res.fee, total: res.total, status: d === 0 ? ["nuevo", "preparando", "listo"][j] || "nuevo" : statuses[k % 5], created_at: created.toISOString(), order_items: res.lines });
      k++;
    }
  }
}

async function login(page, email) {
  await page.goto(BASE + "/admin.html");
  await page.waitForSelector("#loginForm");
  await page.fill("#email", email); await page.fill("#password", "correcta");
  await page.click("#loginBtn");
  await page.waitForSelector("#app:not(.hidden)");
}

(async () => {
  const browser = await chromium.launch();
  const now = new Date(Date.UTC(2026, 10, 17, 12, 0)); // 13:00 Madrid
  const errors = [];

  /* ============ PROPIETARIO (servidor con la actualización preparada) ============ */
  console.log("Propietario · escritorio");
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  let state = H.makeState(); seed(state, now);
  await H.install(page, state); await page.clock.setFixedTime(now);

  await step("12. Acceso: credenciales incorrectas se rechazan", async () => {
    await page.goto(BASE + "/admin.html"); await page.waitForSelector("#loginForm");
    await page.fill("#email", "propietario@telekebab.test"); await page.fill("#password", "mala"); await page.click("#loginBtn");
    await page.waitForSelector("#loginMsg .notice.err");
    assert.equal(await page.locator("#app").isHidden(), true);
  });
  await step("12b. Propietario entra y ve todas las secciones", async () => {
    await page.fill("#password", "correcta"); await page.click("#loginBtn");
    await page.waitForSelector("#app:not(.hidden)");
    const visible = await page.locator("#nav a:not(.hidden) span").allTextContents();
    assert.deepEqual(visible, ["Resumen", "Pedidos", "Carta", "Equipo", "Asistente", "Ajustes"]);
  });
  await step("Dashboard: estados, ventas día/semana/mes, más vendidos y actividad", async () => {
    await page.waitForFunction(() => document.querySelectorAll("#kpiMoney .kpi").length === 4);
    await page.waitForSelector("#chart svg rect");
    const ops = await page.locator("#kpiOps .kpi b").allTextContents();
    assert.deepEqual(ops.slice(0, 3), ["1", "1", "1"]); // nuevo, en cocina, listo (pedidos de hoy)
    const exp = H; void exp;
    const todaySales = state.orders.filter((o) => o.created_at.slice(0, 10) === "2026-11-17" && o.status !== "cancelado").reduce((a, o) => a + o.total, 0);
    assert.equal((await page.locator("#kpiMoney .kpi b").first().textContent()).replace(/ /g, " "), todaySales.toFixed(2).replace(".", ",") + " €");
    assert.ok(await page.locator("#topList .rank li").count() > 0);
    await page.screenshot({ path: OUT + "20-admin-resumen.png", fullPage: true });
  });
  await step("9. Recepción de pedidos en tiempo real (aviso al llegar uno nuevo)", async () => {
    const [st, res] = createOrder({ customer_name: "Nuevo Cliente", phone: "699111222", fulfilment: "pickup", zone: "pickup", address: "", payment_method: "Efectivo", notes: "", items: [{ product_id: state.products.find((p) => p.name === "Nuggets").id, quantity: 2, customizations: {} }] }, state.products);
    assert.equal(st, 200);
    state.orders.unshift({ id: "live-1", order_number: 2001, customer_name: "Nuevo Cliente", phone: "699111222", fulfilment: "pickup", zone: "pickup", address: "", payment_method: "Efectivo", notes: "", subtotal: res.subtotal, delivery_fee: 0, total: res.total, status: "nuevo", created_at: now.toISOString(), order_items: res.lines });
    await page.click("#refreshBtn");
    await page.waitForFunction(() => document.querySelector("#navNew").textContent === "2");
  });
  await step("10. Gestión: aceptar con tiempo estimado, avanzar estados y entregar", async () => {
    await page.click('#nav a[data-view="pedidos"]');
    await page.waitForSelector('.order[data-id="live-1"]');
    await page.screenshot({ path: OUT + "21-admin-pedidos.png" });
    await page.click('.order[data-id="live-1"] [data-to="aceptado"]');
    await page.click('#sheetBody [data-eta="20"]');
    await page.waitForFunction(() => document.querySelector('.order[data-id="live-1"] .badge').textContent === "Aceptado");
    const sent = state.calls.filter((c) => c.path.endsWith("update-order-status")).pop().body;
    assert.equal(sent.expected_status, "nuevo"); assert.ok(sent.estimated_ready_at);
    for (const to of ["preparando", "listo", "completado"]) {
      await page.click(`.order[data-id="live-1"] [data-to="${to}"]`);
      await page.waitForFunction((t) => { const o = window.__tkAdmin.ops.find((x) => x.id === "live-1"); return o && o.status === t; }, to);
    }
    assert.equal(state.orders.find((o) => o.id === "live-1").status, "completado");
  });
  await step("10b. Rechazar un pedido exige motivo y lo registra", async () => {
    const o = state.orders.find((x) => x.status === "nuevo");
    await page.click('#orderFilter [data-f="nuevo"]');
    await page.click(`.order[data-id="${o.id}"] [data-act="cancel"]`);
    await page.click("#doCancel");
    await page.waitForSelector("#toast.show.err");
    await page.check('input[name="cr"][value="Producto agotado"]');
    await page.click("#doCancel");
    await page.waitForFunction((id) => !document.querySelector(`.order[data-id="${id}"]`), o.id);
    assert.equal(o.status, "cancelado");
    assert.equal(state.calls.filter((c) => c.path.endsWith("update-order-status")).pop().body.cancel_reason, "Producto agotado");
  });
  await step("10c. Concurrencia: si otro compañero ya cambió el pedido, avisa y no pisa", async () => {
    await page.click('#orderFilter [data-f="activos"]');
    const o = state.orders.find((x) => x.status === "preparando");
    o.status = "listo"; // otro dispositivo lo cambia sin que este panel lo sepa
    await page.click(`.order[data-id="${o.id}"] [data-to="listo"]`);
    await page.waitForFunction(() => /Otro compañero/.test(document.querySelector("#toast").textContent));
    assert.equal(o.status, "listo");
  });
  await step("13. Impresión de ticket (80 mm) con productos, opciones y total", async () => {
    await page.click('#orderFilter [data-f="hoy"]');
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator('.order [data-act="print"]').first().click()]);
    await popup.waitForLoadState();
    const txt = await popup.locator("body").textContent();
    assert.match(txt, /TELE KEBAB PIZZERÍA/); assert.match(txt, /TOTAL/);
    await popup.screenshot({ path: OUT + "22-ticket.png" });
    await popup.close();
  });
  await step("Histórico por fechas y exportación CSV", async () => {
    await page.click('#orderFilter [data-f="historico"]');
    await page.waitForFunction(() => /pedidos/.test(document.querySelector("#hInfo").textContent));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#hCsv")]);
    assert.match(dl.suggestedFilename(), /^pedidos_.*\.csv$/);
  });
  await step("Carta: ocultar/mostrar producto (agotado) al momento", async () => {
    await page.click('#nav a[data-view="carta"]');
    await page.fill("#prodSearch", "Calamares");
    await page.click('#prodTable tr:has-text("Calamares") [data-toggle]');
    await page.waitForFunction(() => document.querySelector('#prodTable tr [data-toggle]').getAttribute("aria-checked") === "false");
    assert.equal(state.products.find((p) => p.name === "Calamares").active, false);
    await page.click('#prodTable tr:has-text("Calamares") [data-toggle]');
    await page.waitForFunction(() => document.querySelector('#prodTable tr [data-toggle]').getAttribute("aria-checked") === "true");
  });
  await step("Carta: editar precio, tamaños y descripción sugerida; se guardan todos los campos", async () => {
    await page.fill("#prodSearch", "Fungi");
    await page.click('#prodTable tr:has-text("Fungi") [data-edit]');
    await page.waitForSelector("#sheet.open");
    await page.click("#suggestDesc");
    const desc = await page.inputValue('#pf textarea[name="description"]');
    assert.match(desc, /Pizza fungi.*mediana 28 cm o familiar 36 cm/i);
    await page.fill('[data-sp="1"]', "14");
    await page.fill("#cCheese", "0.6");
    await page.screenshot({ path: OUT + "23-admin-editar-producto.png" });
    await page.click("#pfSave");
    await page.waitForSelector("#sheet:not(.open)");
    const p = state.products.find((x) => x.name === "Fungi");
    assert.equal(p.customization_config.sizes[1].price, 14);
    assert.equal(p.customization_config.extra_cheese_price, 0.6);
    assert.equal(p.description, desc);
    assert.equal(await page.locator("#banner .notice").count(), 0);
  });
  await step("Carta: crear producto nuevo (oculto por defecto)", async () => {
    await page.click("#newProduct");
    await page.fill('#pf input[name="name"]', "Producto de prueba");
    await page.fill('#pf input[name="family"]', "Entrantes");
    await page.fill('#pf input[name="category"]', "Fritos");
    await page.fill('#pf input[name="price"]', "3.5");
    await page.click("#pfSave");
    await page.waitForSelector("#sheet:not(.open)");
    const p = state.products.find((x) => x.name === "Producto de prueba");
    assert.ok(p); assert.equal(p.active, false); assert.equal(p.family, "Entrantes");
  });
  await step("Equipo: alta de trabajador con rol y permisos", async () => {
    await page.click('#nav a[data-view="equipo"]');
    await page.waitForSelector("#staffList .staff");
    await page.click("#newStaff");
    await page.fill("#sfName", "Repartidor 1"); await page.fill("#sfEmail", "reparto1@telekebab.test");
    await page.uncheck('[data-perm-k="stock"]');
    await page.click("#sfSave");
    await page.waitForFunction(() => document.querySelectorAll("#staffList .staff").length === 3);
    const u = state.staff.find((s) => s.email === "reparto1@telekebab.test");
    assert.equal(u.role, "staff"); assert.equal(u.permissions.stock, false);
    await page.screenshot({ path: OUT + "24-admin-equipo.png", fullPage: true });
  });
  await step("Equipo: desactivar un trabajador", async () => {
    await page.click('#staffList [data-uid="u-staff"] [data-staff-edit]');
    await page.uncheck("#seActive"); await page.click("#seSave");
    await page.waitForSelector('#staffList .staff.off[data-uid="u-staff"]');
  });
  await step("Asistente: análisis real de ventas, horas, combinaciones y revisión de carta", async () => {
    await page.click('#nav a[data-view="asistente"]');
    await page.waitForSelector("#aiSales .insight");
    assert.match(await page.locator("#aiSales").textContent(), /pedidos válidos/);
    assert.match(await page.locator("#aiTimes").textContent(), /día con más pedidos/);
    assert.match(await page.locator("#aiPairs").textContent(), /aparecen juntos/);
    assert.match(await page.locator("#aiAudit").textContent(), /minúscula/);
    await page.screenshot({ path: OUT + "25-admin-asistente.png", fullPage: true });
  });
  await step("Ajustes: horario, aviso y pausa de pedidos", async () => {
    await page.click('#nav a[data-view="ajustes"]');
    await page.waitForSelector("#hoursRows .size-row");
    await page.fill("#announcement", "Hoy cerramos a las 22:00");
    await page.click('#settingsForm button[type="submit"]');
    await page.waitForSelector("#settingsMsg .notice.ok");
    assert.equal(state.settings.announcement, "Hoy cerramos a las 22:00");
    assert.equal(state.settings.hours.length, 2);
    await page.screenshot({ path: OUT + "26-admin-ajustes.png", fullPage: true });
  });
  await ctx.close();

  /* ============ TRABAJADOR (rol staff) ============ */
  console.log("Trabajador de cocina · móvil");
  ctx = await browser.newContext({ ...devices["Pixel 7"] });
  page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  state = H.makeState(); seed(state, now);
  await H.install(page, state); await page.clock.setFixedTime(now);
  await step("11. Trabajador: sólo ve Resumen, Pedidos y Carta (sin ventas, equipo ni ajustes)", async () => {
    await login(page, "cocina@telekebab.test");
    const tabs = await page.locator("#tabbar a span").allTextContents();
    assert.deepEqual(tabs, ["Resumen", "Pedidos", "Carta"]);
    assert.equal(await page.locator("#kpiMoney").isHidden(), true);
    assert.equal(await page.locator('#orderFilter [data-f="historico"]').isHidden(), true);
    await page.screenshot({ path: OUT + "30-trabajador-movil.png" });
  });
  await step("15. Seguridad: el trabajador no recibe datos financieros históricos (403 del servidor)", async () => {
    const hist = state.calls.filter((c) => c.path.endsWith("admin-orders") && c.body && c.body.from);
    assert.equal(hist.length, 0, "el panel no debe pedir el histórico");
    const r = await page.evaluate(async () => (await fetch(window.TELEKEBAB_CONFIG.url + "/functions/v1/admin-orders", { method: "POST", headers: { Authorization: "Bearer x" }, body: JSON.stringify({ from: "2026-01-01", to: "2026-11-17" }) })).status);
    assert.equal(r, 403);
  });
  await step("11b. Trabajador puede avanzar pedidos y marcar agotados, pero no editar la carta", async () => {
    await page.click('#tabbar a[data-view="pedidos"]');
    const o = state.orders.find((x) => x.status === "listo");
    await page.click(`.order[data-id="${o.id}"] [data-act="next"]`);
    await page.waitForFunction((id) => window.__tkAdmin.ops.find((x) => x.id === id).status !== "listo", o.id);
    await page.click('#tabbar a[data-view="carta"]');
    await page.waitForSelector("#prodTable [data-toggle]:not([disabled])", { state: "attached" });
    assert.equal(await page.locator("#newProduct").isHidden(), true);
    assert.equal(await page.locator("#prodTable [data-edit]").count(), 0);
    assert.ok(await page.locator("#prodTable [data-toggle]:not([disabled])").count() > 0);
    await page.screenshot({ path: OUT + "31-trabajador-carta.png" });
  });
  await ctx.close();

  /* ============ SERVIDOR ACTUAL (sin la actualización desplegada) ============ */
  console.log("Compatibilidad con el servidor actual de producción");
  ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  state = H.makeState(); state.legacy = true; seed(state, now);
  await H.install(page, state); await page.clock.setFixedTime(now);
  await step("Compatibilidad: funciona sin whoami (rol deducido) y avisa de lo pendiente", async () => {
    await login(page, "propietario@telekebab.test");
    await page.waitForSelector("#kpiMoney .kpi");
    await page.click('#nav a[data-view="equipo"]');
    await page.waitForSelector("#staffList .notice.info");
    assert.match(await page.locator("#staffList").textContent(), /pendiente de activación/);
    await page.click('#nav a[data-view="ajustes"]');
    await page.waitForSelector("#settingsMsg .notice.info");
  });
  await step("Compatibilidad: si el servidor no guarda la personalización, el panel lo dice claramente", async () => {
    await page.click('#nav a[data-view="carta"]');
    await page.fill("#prodSearch", "Fungi");
    await page.click('#prodTable tr:has-text("Fungi") [data-edit]');
    await page.fill('[data-sp="1"]', "14");
    await page.click("#pfSave");
    await page.waitForSelector("#banner .notice.warn");
    assert.match(await page.locator("#banner").textContent(), /No se han guardado: personalización/);
  });
  await ctx.close();
  await browser.close();

  await (async () => { await step("Sin errores de JavaScript en el panel", async () => assert.deepEqual(errors, [])); })();
  const failed = results.filter((r) => r[0] !== "OK");
  console.log(`\nResultado: ${results.length - failed.length}/${results.length} pruebas superadas`);
  require("fs").writeFileSync(OUT + "resultado-e2e-panel.json", JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
