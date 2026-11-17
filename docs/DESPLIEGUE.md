# Tele Kebab Pizzería · Guía de publicación

> **Nada de este trabajo está publicado.** Producción sigue sirviendo el despliegue
> `6ae89f66` de Netlify y las Edge Functions actuales. Cada paso de abajo requiere
> la autorización expresa del propietario.

## Arquitectura (sin cambios de tecnología)

| Pieza | Dónde vive | Estado |
|---|---|---|
| Web pública, panel y tablero de cocina | Netlify · proyecto `telekebabpizzeria` → `telekebabpizzeria.com` | Rediseño listo en `site/`, **sin publicar** |
| Base de datos y Edge Functions | Supabase · proyecto `Telekebabpizzeria` (`zifzljhewpimjjulbyqx`) | Migración y funciones listas en `supabase/`, **sin aplicar** |
| `telekebabpizzeriacastellar.com` | Micrositio de **Just Eat** (Cloudflare) | Fuera de este proyecto: no se ha tocado |

Proyectos que **no** se han tocado: Netlify `telekebab-pedidos`, `telekebab-panel-preview`;
Supabase `apropdigital`; cualquier recurso de Aprop Digital, SelloPro o RESTAB.

## Fase A · Publicar sólo el frontend (riesgo bajo)

Funciona con el backend actual tal cual está. Lo nuevo que depende del backend
se muestra como «pendiente de activación», nunca como un botón falso.

1. Revisar la vista previa (opcional, recomendado): despliegue *draft* de `site/` en el
   proyecto Netlify `telekebabpizzeria` (no cambia la versión publicada).
2. Publicar `site/` como despliegue de producción en `telekebabpizzeria`.
3. Comprobar: portada, carta, un pedido de recogida real hecho por el propio
   restaurante, panel `/admin`, tablero `/pedidos`.
4. Vuelta atrás: en Netlify → Deploys → `6ae89f66` → *Publish deploy*.

## Fase B · Backend (requiere autorización)

Orden recomendado:

1. **Migración** `supabase/migrations/20261117120000_staff_roles_audit_settings.sql`
   - Sólo añade tablas, columnas, una política de lectura y un bucket. No borra ni modifica filas.
   - Recomendado: copia de seguridad previa (Supabase → Database → Backups).
2. **Funciones** (todas comparten `supabase/functions/_shared/auth.ts`):
   - `whoami` (nueva) · `admin-staff` (nueva) · `admin-settings` (nueva)
   - `admin-orders` v6 · `update-order-status` v2 · `admin-menu` v3
   - Mantener `verify_jwt: false` como las actuales (la verificación se hace dentro, con `getUser`).
3. Con la migración aplicada, el tablero de cocina recibe pedidos por **tiempo real**
   (hoy siempre cae a consulta periódica porque `orders` no tiene política de lectura).

### Qué arregla la Fase B

| Problema actual en producción | Corrección |
|---|---|
| `admin-menu` v2 descarta familia, orden, personalización y estado de revisión al guardar | v3 guarda todos los campos y valida la configuración |
| `update-order-status` ignora `expected_status`: dos tablets pueden pisarse | v2 hace el cambio condicionado al estado leído (409 si cambió) |
| Cualquier cuenta del panel tiene permisos totales (sólo analíticas mira el rol) | Roles `owner` / `manager` / `staff` + permisos por persona en todas las funciones |
| No consta quién aceptó, canceló o entregó cada pedido | Tabla `order_events` con trabajador, hora y motivo |
| El tiempo estimado y el motivo de cancelación que envía la cocina se pierden | Columnas `estimated_ready_at` y `cancel_reason` |
| No hay forma de crear o desactivar trabajadores sin entrar en Supabase | `admin-staff` (sólo propietario; desactivar = bloqueo inmediato) |

## Pendiente de decisión del propietario (no se ha tocado)

### 1. `create-order` contiene un puente con Aprop Digital
La función envía una copia de cada pedido a otro proyecto Supabase (`fiwpdzlonjeqsaqyxezv`)
y `sync-status` recibe cambios de estado desde allí. Es una **dependencia compartida**:
no se ha modificado. Observaciones:
- El secreto compartido y la clave están **escritos en el código** de ambas funciones.
  Recomendación: moverlos a *Edge Function Secrets* y rotarlos, coordinado con el
  responsable de la otra aplicación.
- `sync-status` no tiene límite de intentos; con el secreto filtrado, cualquiera podría
  cambiar estados de pedidos por número.

### 2. Horario de pedidos en el servidor
`create-order` acepta pedidos de **11:30 a 23:30 seguido**. El horario indicado es
**11:30–16:00 y 18:00–23:00**. La web nueva ya aplica el horario correcto y no deja
enviar fuera de él, pero alguien que llame a la API directamente podría pedir a las 17:00.
Corregirlo exige redesplegar `create-order` (y con ella el puente anterior). Cambio propuesto:

```ts
// sustituir isOpenInBarcelona(): t >= 690 && t < 1410
return (t >= 690 && t < 960) || (t >= 1080 && t < 1380);
```

### 3. Otros
- Activar *Leaked password protection* en Supabase Auth (aviso del asesor de seguridad).
- La tabla `_backup_products_20261102` (copia del 2 de noviembre) puede eliminarse cuando
  se confirme que no hace falta. **No se ha borrado.**
- Fotos de producto: las actuales son reales pero de unos 200 px. Con la Fase B se pueden
  subir fotos nuevas desde el panel. Generarlas con IA tiene coste (Eviolite/Abdel) y no
  se ha hecho sin autorización; además, una imagen generada no debe presentarse como foto
  real del plato.
