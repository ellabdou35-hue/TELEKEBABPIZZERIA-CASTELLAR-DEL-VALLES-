/* Prueba de humo del tablero de cocina (/pedidos): carga, sesión y permisos por rol. */
"use strict";
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./harness.js");
const BASE = process.argv[2] || "http://127.0.0.1:8080";
const OUT = __dirname + "/../docs/evidencias/";
(async () => {
  const browser = await chromium.launch();
  const res = [];
  for (const [who, email, canReports] of [["propietario", "propietario@telekebab.test", true], ["trabajador", "cocina@telekebab.test", false]]) {
    const ctx = await browser.newContext({ ...devices["Galaxy Tab S4"] });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const st = H.makeState(); await H.install(page, st); await H.setMadridTime(page, 13, 0);
    await page.goto(BASE + "/pedidos.html");
    await page.waitForSelector("#loginCard:not(.hidden)");
    await page.fill("#email", email); await page.fill("#password", "correcta");
    await page.click('#loginCard button');
    await page.waitForSelector("#app:not(.hidden)");
    await page.waitForSelector("#whoTag");
    const reportsHidden = await page.locator('.tab[data-v="reports"]').evaluate((e) => ({ cls: e.className, disp: getComputedStyle(e).display, par: getComputedStyle(e.parentElement).display, tk: window.TK_CAN_REPORTS })).then((x) => { console.log(JSON.stringify(x)); return x.cls.includes('hidden'); });
    try {
      assert.equal(reportsHidden, !canReports);
      assert.match(await page.locator("#whoTag").textContent(), canReports ? /Propietario/ : /Cocina/);
      assert.deepEqual(errors, []);
      res.push(["OK", "Tablero de cocina · " + who + ": identidad visible e informes " + (canReports ? "visibles" : "ocultos")]);
    } catch (e) { res.push(["FALLO", "Tablero de cocina · " + who, e.message]); }
    await page.screenshot({ path: OUT + "40-cocina-" + who + ".png" });
    await ctx.close();
  }
  await browser.close();
  res.forEach((r) => console.log(r[0] === "OK" ? "  ✔" : "  ✘", r[1], r[2] || ""));
  console.log(`\nResultado: ${res.filter((r) => r[0] === "OK").length}/${res.length} pruebas superadas`);
  require("fs").writeFileSync(OUT + "resultado-e2e-cocina.json", JSON.stringify(res, null, 2));
  process.exit(res.some((r) => r[0] !== "OK") ? 1 : 0);
})();
