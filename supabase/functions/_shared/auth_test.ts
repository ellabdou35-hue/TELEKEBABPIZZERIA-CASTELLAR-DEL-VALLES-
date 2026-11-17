import { effectivePermissions } from "./auth.ts";

function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(JSON.stringify(a) + " !== " + JSON.stringify(b)); }

Deno.test("El propietario siempre tiene todos los permisos", () => {
  eq(effectivePermissions("owner", { reports: false, menu_edit: false }).length, 8);
});
Deno.test("Trabajador: permisos por defecto de cocina", () => {
  eq(effectivePermissions("staff").sort(), ["orders_update", "orders_view", "stock"]);
});
Deno.test("Overrides: se pueden quitar y añadir, salvo equipo y ajustes", () => {
  const p = effectivePermissions("staff", { stock: false, orders_cancel: true, staff_manage: true, settings: true });
  eq(p.sort(), ["orders_cancel", "orders_update", "orders_view"]);
});
Deno.test("Encargado: ventas y carta, sin equipo ni ajustes", () => {
  const p = effectivePermissions("manager");
  eq([p.includes("reports"), p.includes("menu_edit"), p.includes("staff_manage"), p.includes("settings")], [true, true, false, false]);
});
