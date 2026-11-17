// Pedidos para los paneles. Versión con roles:
//  - view "operational" (pedidos de hoy + activos): cualquier trabajador activo con orders_view.
//  - histórico por fechas: sólo con permiso "reports" (propietario / encargado).
//  - view "events": actividad reciente (quién hizo qué), con permiso "reports".
// Compatible con los paneles actuales (mismos parámetros y formato de respuesta).
import { adminClient, cors, deny, getActor, madridMidnight, madridToday, reply } from "../_shared/auth.ts";

const ACTIVE = "nuevo,aceptado,preparando,listo,en_reparto";
const BASE = "id,order_number,customer_name,phone,fulfilment,zone,address,table_number,payment_method,notes,subtotal,delivery_fee,total,status,created_at,order_items(id,product_name,unit_price,quantity,line_total,customizations)";
const EXTRA = ",estimated_ready_at,cancel_reason";
const validDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    if (!actor.can("orders_view")) return deny("orders_view");
    let f: { from?: string | null; to?: string | null; view?: string | null; date?: string | null; limit?: number } = {};
    if (req.method === "POST") { try { f = await req.json(); } catch { /* cuerpo vacío */ } }

    // Columnas nuevas si la migración está aplicada; si no, las de siempre.
    const sel = async (build: (s: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
      const r = await build(BASE + EXTRA);
      if (r.error && /column/i.test(r.error.message)) return await build(BASE);
      return r;
    };

    if (f.view === "operational") {
      const day = validDate(f.date) ? f.date! : madridToday();
      const start = madridMidnight(day);
      const { data, error } = await sel((s) => admin.from("orders").select(s).or(`created_at.gte.${start},status.in.(${ACTIVE})`).order("created_at", { ascending: false }).limit(500));
      if (error) throw error;
      const orders = (data as unknown[]) || [];
      return reply(200, { orders, count: orders.length, view: "operational", date: day, role: actor.role });
    }

    if (!actor.can("reports")) return deny("reports");

    if (f.view === "events") {
      const { data, error } = await admin.from("order_events").select("id,order_id,from_status,to_status,actor_name,note,created_at,orders(order_number)").order("created_at", { ascending: false }).limit(Math.min(Number(f.limit) || 100, 500));
      if (error) return reply(200, { events: [], unavailable: true });
      return reply(200, { events: data || [] });
    }

    if (f.from != null && !validDate(f.from)) return reply(400, { error: "Fecha inicial no válida" });
    if (f.to != null && !validDate(f.to)) return reply(400, { error: "Fecha final no válida" });
    if (f.from && f.to && f.from > f.to) return reply(400, { error: "El rango de fechas no es válido" });
    const all: unknown[] = []; const pageSize = 500; let offset = 0;
    while (true) {
      const { data, error } = await sel((s) => {
        let q = admin.from("orders").select(s).order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
        if (f.from) q = q.gte("created_at", madridMidnight(f.from));
        if (f.to) { const [y, m, d] = f.to.split("-").map(Number); q = q.lt("created_at", madridMidnight(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10))); }
        return q;
      });
      if (error) throw error;
      const rows = (data as unknown[]) || [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      offset += pageSize;
      if (offset >= 50000) return reply(413, { error: "El periodo contiene demasiados pedidos. Acota el rango de fechas." });
    }
    return reply(200, { orders: all, count: all.length, from: f.from || null, to: f.to || null });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudieron cargar los pedidos" });
  }
});
