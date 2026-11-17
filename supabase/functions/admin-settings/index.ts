// Configuración de la web pública (sólo propietario): horario, aviso destacado y pausa de pedidos.
// Las tarifas de reparto y los mínimos los aplica create-order; se muestran aquí como lectura
// hasta que esa función (que contiene el puente con otra aplicación) se actualice con autorización.
import { adminClient, cors, deny, getActor, reply } from "../_shared/auth.ts";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function clean(v: Record<string, any>) {
  const hours = Array.isArray(v.hours) ? v.hours.slice(0, 4).map((h: any) => ({ from: String(h.from), to: String(h.to) })) : [];
  if (!hours.length || hours.some((h: any) => !HHMM.test(h.from) || !HHMM.test(h.to) || h.from >= h.to)) throw new Error("Horario no válido");
  return { hours, announcement: String(v.announcement || "").trim().slice(0, 200), ordering_paused: v.ordering_paused === true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    let body: Record<string, any> = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { /* vacío */ } }
    if (!body.settings) {
      const { data, error } = await admin.from("site_settings").select("value,updated_at").eq("key", "public").maybeSingle();
      if (error) return reply(503, { error: "La configuración aún no está activada en la base de datos" });
      return reply(200, { settings: data?.value || null, updated_at: data?.updated_at || null });
    }
    if (!actor.can("settings")) return deny("settings");
    let value;
    try { value = clean(body.settings); } catch (e) { return reply(400, { error: (e as Error).message }); }
    const { error } = await admin.from("site_settings").upsert({ key: "public", value, updated_at: new Date().toISOString(), updated_by: actor.id });
    if (error) throw error;
    return reply(200, { ok: true, settings: value });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudo guardar la configuración" });
  }
});
