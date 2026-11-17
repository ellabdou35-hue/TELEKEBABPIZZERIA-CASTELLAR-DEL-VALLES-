# Informe de entrega · Tele Kebab Pizzería

Fecha: 17/11/2026 · Rama: `claude/tele-kebab-redesign-premium-h1fj3v`

## Estado de producción

**Frontend publicado** el 17/11/2026 con autorización del propietario: despliegue Netlify
`6afc0985baf6fd2513788247` en telekebabpizzeria.com. Vuelta atrás: publicar de nuevo `6ae89f66`.
Verificado en producción: 101 productos reales, personalización, /admin, /pedidos, cabeceras de seguridad.
La base de datos y las Edge Functions **no** se han modificado (fase B pendiente de autorización).
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
