# Informe de entrega · Tele Kebab Pizzería

Fecha: 17/11/2026 · Rama: `claude/tele-kebab-redesign-premium-h1fj3v`

## Estado de producción

**No se ha publicado nada.** telekebabpizzeria.com sigue en el despliegue `6ae89f66`;
la base de datos y las Edge Functions no se han modificado (sólo lecturas).
No se han creado pedidos, ni enviado comunicaciones, ni activado servicios de pago.

## Pruebas ejecutadas

| Suite | Resultado |
|---|---|
| Paridad de precios web ↔ servidor (101 productos reales, 1.000 combinaciones, envío y mínimos por zona, horario) | 6/6 ✔ |
| Asistente (no inventa datos, KPIs, pares, revisión de carta, descripciones) | 5/5 ✔ |
| Permisos de las Edge Functions (Deno) + comprobación de tipos estricta de las 6 funciones | 4/4 ✔ |
| E2E web pública (escritorio + iPhone 13) | 20/20 ✔ |
| E2E panel (propietario, trabajador en móvil, compatibilidad con el servidor actual) | 22/22 ✔ |
| E2E tablero de cocina por rol | 2/2 ✔ |
| Accesibilidad axe-core WCAG 2 A/AA (web escritorio, web móvil, panel) | 0 incumplimientos |

Detalle en `docs/evidencias/resultado-*.json` y capturas en `docs/evidencias/*.png`.
