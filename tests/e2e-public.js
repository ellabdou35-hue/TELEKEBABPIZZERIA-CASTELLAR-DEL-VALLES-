/* E2E de la web pública. Uso: node tests/e2e-public.js [baseURL] (servidor estático en site/) */
"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./harness.js");
const BASE = process.argv[2] || "http://127.0.0.1:8080";
const OUT = __dirname + "/../docs/evidencias/";
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["OK", name]); console.log("  ✔", name); }
  catch (e) { results.push(["FALLO", name, e.message]); console.log("  ✘", name, "\n    ", e.message.split("\n")[0]); }
}

(async () => {
  const browser = await chromium.launch();

  /* ===================== ESCRITORIO ===================== */
  console.log("Escritorio 1440×900");
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  let page = await ctx.newPage();
  let state = H.makeState();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await H.install(page, state); await H.setMadridTime(page, 13, 0);
  await page.goto(BASE + "/");

  await step("1. Navegación: carga la portada con la carta real (101 productos)", async () => {
    await page.waitForSelector("#menu .card");
    const n = await page.locator("#menu .card").count();
    assert.equal(n, 101);
    assert.match(await page.locator("#liveText").textContent(), /Abierto ahora/);
  });
  await step("1b. SEO: título, descripción, canonical y datos estructurados Restaurant", async () => {
    assert.match(await page.title(), /Castellar del Vallès/);
    const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    assert.equal(ld["@type"], "Restaurant"); assert.equal(ld.telephone, "+34 937 47 46 96");
    assert.equal(ld.openingHoursSpecification.length, 2);
  });
  await step("2. Visualización: filtro por familia y búsqueda", async () => {
    await page.click('#tabs .tab[data-family="Pizzas"]');
    const fams = await page.locator("#menu .family h3").allTextContents();
    assert.deepEqual(fams, ["Pizzas"]);
    await page.fill("#search", "barbacoa");
    const names = await page.locator("#menu .card h4").allTextContents();
    assert.ok(names.includes("Barbacoa"), names.join());
    await page.fill("#search", "");
    await page.click('#tabs .tab[data-family="Todas"]');
  });
  await step("3. Personalización: pizza exige tamaño y suma extras (Barbacoa familiar + 2 ingredientes + queso)", async () => {
    await page.fill("#search", "barbacoa");
    await page.click('#menu .card:has(h4:text-is("Barbacoa")) .add-btn');
    await page.waitForSelector("#productModal.open");
    await page.click("#pmAdd");
    assert.match(await page.locator("#pmError").textContent(), /tamaño/i);
    await page.click('#pmOptions [data-group="size"] .choice[data-v="Familiar 36 cm"]');
    await page.click('#pmOptions [data-group="extra_ingredients"] .choice[data-v="Bacon"]');
    await page.click('#pmOptions [data-group="extra_ingredients"] .choice[data-v="Cebolla"]');
    await page.click('#pmOptions [data-group="extra_cheese"] .choice');
    await page.click('#pmOptions [data-group="remove_ingredients"] .choice >> nth=0');
    await page.fill("#pmNotes", "Bien hecha");
    const pizza = H.products.find((p) => p.name === "Barbacoa");
    const big = pizza.customization_config.sizes.find((s) => s.name === "Familiar 36 cm").price;
    const expected = big + 2 * pizza.customization_config.extra_ingredient_price + pizza.customization_config.extra_cheese_price;
    await page.screenshot({ path: OUT + "02-personalizacion-pizza.png" });
    assert.match(await page.locator("#pmPrice").textContent(), new RegExp(expected.toFixed(2).replace(".", ",")));
    await page.click("#pmAdd");
    await page.waitForSelector("#productModal.open", { state: "detached" });
    await page.fill("#search", "");
  });
  await step("3b. Personalización: menú dürüm con carne, bebida con suplemento y salsa extra", async () => {
    await page.click('#featured .card:has(h4:text-is("Menú dürüm kebab")) .add-btn');
    await page.click('#pmOptions [data-group="meat_choice"] .choice[data-v="Ternera"]');
    await page.selectOption('#pmOptions [data-sel="menu_drink"]', "Red Bull");
    await page.click('#pmOptions [data-group="extra_sauces"] .choice[data-v="Salsa picante"]');
    assert.match(await page.locator("#pmPrice").textContent(), /10,30/); // 9,00 + 0,30 Red Bull + 1,00 salsa
    await page.click("#pmPlus");
    assert.match(await page.locator("#pmPrice").textContent(), /20,60/);
    await page.click("#pmAdd");
  });
  await step("4. Carrito: añadir directo, modificar cantidades, eliminar", async () => {
    await page.fill("#search", "coca-cola");
    await page.click('#menu .card:has(h4:text-is("Coca-Cola")) .add-btn');
    await page.fill("#search", "");
    assert.equal(await page.locator("#cartBadge").textContent(), "4");
    await page.click("#cartFab");
    await page.waitForSelector("#drawer.open");
    assert.equal(await page.locator("#cartLines .line").count(), 3);
    await page.click('#cartLines [data-inc="2"]');
    assert.equal(await page.locator("#cartBadge").textContent(), "5");
    await page.click('#cartLines [data-del="2"]');
    assert.equal(await page.locator("#cartLines .line").count(), 2);
    await page.screenshot({ path: OUT + "03-carrito.png" });
  });
  await step("5. Importes: subtotal = suma exacta de líneas", async () => {
    const t = await page.evaluate(() => window.__tk.totals());
    const c = H.products.find((p) => p.name === "Barbacoa").customization_config;
    const pizzaLine = c.sizes.find((s) => s.name === "Familiar 36 cm").price + 2 * c.extra_ingredient_price + c.extra_cheese_price;
    global.EXPECTED_SUB = Math.round((pizzaLine + 20.6) * 100) / 100;
    assert.equal(t.subtotal, global.EXPECTED_SUB, JSON.stringify(t));
  });
  await step("6. Envío por zona: Castellar 1,50 € · Sentmenat 3 € · Sant Llorenç 10 €", async () => {
    await page.click("#mainCta");
    await page.waitForSelector("#stepCheckout:not(.hidden)");
    await page.selectOption("#zone", "castellar"); assert.equal((await page.locator("#sFee").textContent()).replace(/\u00a0/g, " "), "1,50 €");
    await page.selectOption("#zone", "sentmenat"); assert.equal((await page.locator("#sFee").textContent()).replace(/\u00a0/g, " "), "3,00 €");
    await page.selectOption("#zone", "sant_llorenc_savall"); assert.equal((await page.locator("#sFee").textContent()).replace(/\u00a0/g, " "), "10,00 €");
    await page.click('label[for="fPickup"]'); assert.equal((await page.locator("#sFee").textContent()).replace(/\u00a0/g, " "), "Gratis");
    await page.click('label[for="fDelivery"]');
  });
  await step("7. Pedido mínimo: Sant Llorenç (50 €) bloquea el envío y avisa de lo que falta", async () => {
    await page.selectOption("#zone", "sant_llorenc_savall");
    const miss = (50 - global.EXPECTED_SUB).toFixed(2).replace(".", ",");
    assert.ok((await page.locator("#footMsg").textContent()).includes("Te faltan " + miss), await page.locator("#footMsg").textContent());
    assert.equal(await page.locator("#mainCta").isDisabled(), true);
  });
  await step("7b. Validación de datos del cliente", async () => {
    await page.selectOption("#zone", "castellar");
    await page.click("#mainCta");
    assert.match(await page.locator("#footMsg").textContent(), /nombre/);
    assert.equal(await page.locator("#customerName").getAttribute("aria-invalid"), "true");
    await page.screenshot({ path: OUT + "04-checkout-validacion.png" });
  });
  await step("8. Pedido de prueba controlado (simulado, sin tocar producción) y confirmación con número", async () => {
    await page.fill("#customerName", "Cliente Prueba");
    await page.fill("#phone", "600 111 222");
    await page.fill("#address", "Carrer de Prova 1, 2º 1ª");
    await page.click('label[for="pay1"]');
    await page.fill("#notes", "PRUEBA AUTOMÁTICA");
    await page.click("#mainCta");
    await page.waitForSelector("#stepDone:not(.hidden)");
    assert.match(await page.locator(".order-no").textContent(), /#1201/);
    const sent = state.calls.find((c) => c.path.endsWith("create-order")).body;
    assert.equal(sent.zone, "castellar"); assert.equal(sent.payment_method, "Tarjeta física en TPV");
    assert.equal(sent.items.length, 2);
    const total = Math.round((global.EXPECTED_SUB + 1.5) * 100) / 100;
    assert.equal(state.orders[0].total, total);
    assert.ok((await page.locator("#stepDone").textContent()).includes(total.toFixed(2).replace(".", ",")));
    await page.waitForSelector("#liveStatus .timeline");
    await page.screenshot({ path: OUT + "05-confirmacion.png" });
  });
  await step("8b. Protección contra doble envío: un único create-order por pedido", async () => {
    assert.equal(state.calls.filter((c) => c.path.endsWith("create-order")).length, 1);
  });
  await step("8c. Estado del pedido e historial en el dispositivo", async () => {
    state.orders[0].status = "preparando";
    await page.click("#stepDone [data-close]");
    await page.click('#history button[data-track="1201"]');
    await page.waitForSelector("#trackResult .timeline");
    assert.match(await page.locator("#trackResult").textContent(), /En preparación/);
    await page.locator("#seguimiento").screenshot({ path: OUT + "06-seguimiento.png" });
  });
  await step("8d. Seguimiento con datos erróneos muestra error claro", async () => {
    await page.fill("#trackNumber", "9999"); await page.fill("#trackPhone", "600000000");
    await page.click("#trackBtn");
    await page.waitForSelector("#trackResult .notice.err");
  });
  await step("8e. Fuera de horario (17:00) no se puede enviar el pedido", async () => {
    await H.setMadridTime(page, 17, 0);
    await page.reload(); await page.waitForSelector("#menu .card");
    assert.match(await page.locator("#liveText").textContent(), /Cerrado ahora · abrimos a las 18:00/);
    await page.fill("#search", "patatas fritas");
    await page.click('#menu .card:has(h4:text-is("Patatas fritas")) .add-btn');
    await page.click("#cartFab"); await page.click("#mainCta");
    assert.match(await page.locator("#footMsg").textContent(), /cerrados/);
    await page.click('label[for="fPickup"]');
    await page.fill("#customerName", "Cliente Prueba"); await page.fill("#phone", "600111222");
    assert.equal(await page.locator("#mainCta").isDisabled(), true);
  });
  await step("Sin errores de JavaScript en la página", async () => { assert.deepEqual(errors, []); });
  await ctx.close();

  /* ===================== MÓVIL ===================== */
  console.log("Móvil (iPhone 13)");
  ctx = await browser.newContext({ ...devices["iPhone 13"] });
  page = await ctx.newPage(); state = H.makeState();
  await H.install(page, state); await H.setMadridTime(page, 20, 30);
  await page.goto(BASE + "/");
  await page.waitForSelector("#menu .card");
  await step("14. Móvil: sin desbordamiento horizontal", async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 0, "desborda " + over + "px");
    await page.screenshot({ path: OUT + "10-movil-portada.png" });
  });
  await step("14b. Móvil: pedido completo para recoger (oferta 2 kebab con elecciones por unidad)", async () => {
    await page.locator('#featured .card:has(h4:text-is("Oferta 2 kebab/dürüm + patatas")) .add-btn').click();
    await page.selectOption('[data-sel="unit_style_0"]', "Dürüm kebab");
    await page.selectOption('[data-sel="unit_meat_0"]', "Pollo");
    await page.selectOption('[data-sel="unit_style_1"]', "Kebab en pita");
    await page.selectOption('[data-sel="unit_meat_1"]', "Mixta");
    await page.screenshot({ path: OUT + "11-movil-personalizar.png" });
    await page.click("#pmAdd");
    await page.click("#cartFab");
    await page.waitForSelector("#drawer.open"); await page.waitForTimeout(450);
    await page.screenshot({ path: OUT + "12-movil-carrito.png" });
    await page.click("#mainCta");
    await page.click('label[for="fPickup"]');
    await page.fill("#customerName", "Prueba Móvil"); await page.fill("#phone", "611222333");
    await page.screenshot({ path: OUT + "13-movil-checkout.png" });
    await page.click("#mainCta");
    await page.waitForSelector("#stepDone:not(.hidden)");
    assert.equal(state.orders[0].total, 14.99);
    assert.equal(state.orders[0].zone, "pickup");
    await page.screenshot({ path: OUT + "14-movil-confirmacion.png" });
  });
  await step("14c. Móvil: el pedido mínimo no aplica a recogida y los datos se recuerdan", async () => {
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tk_customer")));
    assert.equal(saved.name, "Prueba Móvil");
  });
  await step("14d. QR de mesa (?mesa=T2): permite pedir para comer en el local", async () => {
    await page.goto(BASE + "/?mesa=T2"); await page.waitForSelector("#menu .card");
    await page.fill("#search", "nuggets");
    await page.locator('#menu .card:has(h4:text-is("Nuggets")) .add-btn').click();
    await page.click("#cartFab"); await page.click("#mainCta");
    assert.equal(await page.locator("#fDine").isChecked(), true);
    await page.click("#mainCta");
    await page.waitForSelector("#stepDone:not(.hidden)");
    assert.equal(state.orders[0].table_number, "T2");
  });
  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => r[0] !== "OK");
  console.log(`\nResultado: ${results.length - failed.length}/${results.length} pruebas superadas`);
  require("fs").writeFileSync(OUT + "resultado-e2e-publico.json", JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
