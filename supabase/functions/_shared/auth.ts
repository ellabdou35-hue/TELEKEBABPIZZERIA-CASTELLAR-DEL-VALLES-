// Tele Kebab · utilidades comunes de las Edge Functions de administración.
// Identifica al trabajador, su rol y sus permisos. Compatible con la base de datos
// actual: si la tabla staff_profiles aún no existe, se usan los valores por defecto.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
export const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

export type Role = "owner" | "manager" | "staff";
export type Permission =
  | "orders_view"     // ver pedidos activos y del día
  | "orders_update"   // aceptar y avanzar estados
  | "orders_cancel"   // cancelar / rechazar
  | "stock"           // marcar productos agotados / disponibles
  | "menu_edit"       // crear y editar productos, precios, fotos
  | "reports"         // histórico, ventas y estadísticas
  | "staff_manage"    // gestionar trabajadores
  | "settings";       // configuración de la web

const ROLE_DEFAULTS: Record<Role, Permission[]> = {
  owner: ["orders_view", "orders_update", "orders_cancel", "stock", "menu_edit", "reports", "staff_manage", "settings"],
  manager: ["orders_view", "orders_update", "orders_cancel", "stock", "menu_edit", "reports"],
  staff: ["orders_view", "orders_update", "stock"],
};
export const ALL_PERMISSIONS = ROLE_DEFAULTS.owner;

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  permissions: Permission[];
  can: (p: Permission) => boolean;
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Falta configuración del servidor");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Permisos efectivos = los del rol + overrides explícitos (true añade, false quita).
// El propietario siempre conserva todos los permisos.
export function effectivePermissions(role: Role, overrides: Record<string, unknown> = {}): Permission[] {
  if (role === "owner") return [...ROLE_DEFAULTS.owner];
  const set = new Set<Permission>(ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.staff);
  for (const p of ALL_PERMISSIONS) {
    if (p === "staff_manage" || p === "settings") continue; // reservado al propietario
    if (overrides[p] === true) set.add(p);
    if (overrides[p] === false) set.delete(p);
  }
  return [...set];
}

export async function getActor(req: Request, admin: SupabaseClient): Promise<Actor | Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sesión requerida" });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return reply(401, { error: "Sesión no válida" });
  const { data: row, error: rErr } = await admin.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
  if (rErr) throw rErr;
  if (!row) return reply(403, { error: "Este usuario no tiene acceso al panel" });
  const role = (["owner", "manager", "staff"].includes(row.role) ? row.role : "staff") as Role;
  let name = (user.email || "").split("@")[0], active = true, overrides: Record<string, unknown> = {};
  const { data: prof, error: pErr } = await admin.from("staff_profiles").select("display_name,active,permissions").eq("user_id", user.id).maybeSingle();
  if (!pErr && prof) { name = prof.display_name || name; active = prof.active !== false; overrides = prof.permissions || {}; }
  if (!active) return reply(403, { error: "Tu acceso está desactivado. Habla con el responsable." });
  const permissions = effectivePermissions(role, overrides);
  return { id: user.id, email: user.email || "", name, role, active, permissions, can: (p) => permissions.includes(p) };
}

export function deny(p: Permission) {
  return reply(403, { error: "No tienes permiso para esta acción (" + p + ")" });
}

// Registro de actividad. Si la tabla aún no existe, no bloquea la operación.
export async function logEvent(admin: SupabaseClient, ev: { order_id: string; from_status?: string | null; to_status: string; actor: Actor; note?: string }) {
  const { error } = await admin.from("order_events").insert({
    order_id: ev.order_id, from_status: ev.from_status ?? null, to_status: ev.to_status,
    actor_id: ev.actor.id, actor_name: ev.actor.name, note: (ev.note || "").slice(0, 300),
  });
  if (error) console.warn("order_events no disponible:", error.message);
}

export function madridMidnight(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const v: Record<string, string> = {};
    for (const p of parts) v[p.type] = p.value;
    const represented = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}
export const madridToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
