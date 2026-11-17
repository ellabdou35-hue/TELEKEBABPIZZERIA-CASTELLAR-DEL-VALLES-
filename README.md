# Tele Kebab Pizzería · Castellar del Vallès

Web pública, panel de administración y tablero de cocina de **telekebabpizzeria.com**.

- **Frontend**: HTML + CSS + JavaScript sin compilación, en `site/` (se publica tal cual en Netlify, proyecto `telekebabpizzeria`).
- **Backend**: Supabase (`zifzljhewpimjjulbyqx`): Postgres + Edge Functions. Lo preparado está en `supabase/`.

| Ruta | Para quién |
|---|---|
| `/` | Clientes: carta, personalización, pedido, seguimiento |
| `/admin` | Propietario y equipo: resumen, pedidos, carta, equipo, asistente, ajustes |
| `/pedidos` | Cocina y reparto: tablero en tiempo real, tickets, agotados |
| `/?mesa=T2` | QR de mesa: pedido para comer en el local |

## Desarrollo y pruebas

```bash
npm run serve        # http://127.0.0.1:8080
npm run test:unit    # paridad de precios web/servidor, asistente
npm run test:e2e     # Playwright: web, panel y cocina (Supabase simulado, sin tocar producción)
```

Las pruebas E2E interceptan todas las llamadas a Supabase: la carta sale de
`tests/fixtures/products.json` (copia de la carta real) y los pedidos se validan con
`tests/server-port.js`, una copia fiel de la lógica de `create-order`. **Nunca se crean pedidos reales.**

## Publicación

Ver [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). Nada se publica sin autorización del propietario.
