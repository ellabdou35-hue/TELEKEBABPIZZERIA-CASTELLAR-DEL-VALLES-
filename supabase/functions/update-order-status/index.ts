// Cambio de estado de un pedido con permisos, control de concurrencia y registro de actividad.
// Acepta los mismos parámetros que hoy envían los paneles: id, status, expected_status,
// estimated_ready_at (al aceptar) y cancel_reason (al cancelar).
import { adminClient, cors, deny, getActor, logEvent, reply } from "../_shared/auth.ts";

const STATUSES = ["nuevo", "aceptado", "preparando", "listo", "en_reparto", "completado", "cancelado"];
// Transiciones permitidas (se admite saltar pasos hacia delante; no volver atrás salvo propietario/encargado).
const ORDER = ["nuevo", "aceptado", "preparando", "listo", "en_reparto", "completado"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Método no permitido" });
  try {
    const body = await req.json();
    if (!body.id || !STATUSES.includes(body.status)) return reply(400, { error: "Pedido o estado no válido" });
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    if (body.status === "cancelado" ? !actor.can("orders_cancel") : !actor.can("orders_update")) return deny(body.status === "cancelado" ? "orders_cancel" : "orders_update");

    const { data: current, error: cErr } = await admin.from("orders").select("id,status,fulfilment").eq("id", body.id).maybeSingle();
    if (cErr) throw cErr;
    if (!current) return reply(404, { error: "Pedido no encontrado" });
    if (body.expected_status && body.expected_status !== current.status) {
      return reply(409, { error: "Otro compañero ya cambió este pedido. Actualiza la pantalla.", status: current.status });
    }
    if (current.status === body.status) return reply(200, { ok: true, unchanged: true });
    const back = ORDER.indexOf(body.status) >= 0 && ORDER.indexOf(current.status) > ORDER.indexOf(body.status);
    const reopen = ["completado", "cancelado"].includes(current.status);
    if ((back || reopen) && !actor.can("reports")) return reply(403, { error: "Sólo el responsable puede reabrir o retroceder un pedido" });
    if (body.status === "en_reparto" && current.fulfilment !== "delivery") return reply(400, { error: "Sólo los pedidos a domicilio pasan a reparto" });

    const patch: Record<string, unknown> = { status: body.status };
    const extra: Record<string, unknown> = {};
    if (body.status === "aceptado" && body.estimated_ready_at && !Number.isNaN(Date.parse(body.estimated_ready_at))) extra.estimated_ready_at = new Date(body.estimated_ready_at).toISOString();
    if (body.status === "cancelado") extra.cancel_reason = String(body.cancel_reason || "").slice(0, 200);
    extra.handled_by = actor.id;

    // Guardado atómico condicionado al estado leído (evita carreras entre dos tablets).
    let upd = await admin.from("orders").update({ ...patch, ...extra }).eq("id", body.id).eq("status", current.status).select("id");
    if (upd.error && /column/i.test(upd.error.message)) upd = await admin.from("orders").update(patch).eq("id", body.id).eq("status", current.status).select("id");
    if (upd.error) throw upd.error;
    if (!upd.data?.length) return reply(409, { error: "Otro compañero ya cambió este pedido. Actualiza la pantalla." });

    const note = body.status === "cancelado" ? "Motivo: " + (extra.cancel_reason || "sin indicar")
      : extra.estimated_ready_at ? "Listo aprox. " + new Date(String(extra.estimated_ready_at)).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }) : "";
    await logEvent(admin, { order_id: body.id, from_status: current.status, to_status: body.status, actor, note });
    return reply(200, { ok: true });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudo actualizar el pedido" });
  }
});
