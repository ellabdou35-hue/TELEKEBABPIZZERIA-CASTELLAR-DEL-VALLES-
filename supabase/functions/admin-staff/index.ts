// Gestión de trabajadores (sólo propietario).
//  list    → trabajadores con rol, estado, permisos y último acceso.
//  create  → crea la cuenta (email + contraseña inicial), rol y perfil.
//  update  → nombre, rol, permisos, activar/desactivar (bloquea el inicio de sesión) o nueva contraseña.
// Nunca se borran cuentas: se desactivan, para conservar el historial de actividad.
import { adminClient, ALL_PERMISSIONS, cors, deny, effectivePermissions, getActor, reply, Role } from "../_shared/auth.ts";

const ROLES: Role[] = ["owner", "manager", "staff"];
const cleanPerms = (p: unknown) => {
  const out: Record<string, boolean> = {};
  if (p && typeof p === "object") for (const k of ALL_PERMISSIONS) if (typeof (p as Record<string, unknown>)[k] === "boolean") out[k] = (p as Record<string, boolean>)[k];
  return out;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    if (!actor.can("staff_manage")) return deny("staff_manage");
    let body: Record<string, any> = {};
    if (req.method === "POST") { try { body = await req.json(); } catch { /* vacío */ } }
    const action = body.action || "list";

    if (action === "list") {
      const { data: rows, error } = await admin.from("admin_users").select("user_id,role,created_at");
      if (error) throw error;
      const { data: profs } = await admin.from("staff_profiles").select("user_id,display_name,active,permissions");
      const staff = [];
      for (const r of rows || []) {
        const { data: u } = await admin.auth.admin.getUserById(r.user_id);
        const p = (profs || []).find((x) => x.user_id === r.user_id);
        staff.push({
          user_id: r.user_id, email: u?.user?.email || "", role: r.role,
          display_name: p?.display_name || (u?.user?.email || "").split("@")[0],
          active: p ? p.active !== false : true, permissions: p?.permissions || {},
          effective: effectivePermissions(r.role, p?.permissions || {}),
          last_sign_in_at: u?.user?.last_sign_in_at || null, created_at: r.created_at,
        });
      }
      return reply(200, { staff, me: actor.id });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = ROLES.includes(body.role) ? body.role : "staff";
      const display = String(body.display_name || "").trim().slice(0, 60);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "Correo no válido" });
      if (password.length < 10) return reply(400, { error: "La contraseña inicial debe tener al menos 10 caracteres" });
      if (!display) return reply(400, { error: "Indica el nombre del trabajador" });
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: display } });
      if (error || !created.user) return reply(400, { error: /already/i.test(error?.message || "") ? "Ya existe una cuenta con ese correo" : "No se pudo crear la cuenta" });
      const uid = created.user.id;
      const { error: aErr } = await admin.from("admin_users").insert({ user_id: uid, role });
      if (aErr) { await admin.auth.admin.deleteUser(uid); throw aErr; } // deshace la cuenta recién creada (sin datos)
      await admin.from("staff_profiles").upsert({ user_id: uid, display_name: display, active: true, permissions: cleanPerms(body.permissions) });
      return reply(200, { ok: true, user_id: uid });
    }

    if (action === "update") {
      const uid = String(body.user_id || "");
      const { data: row } = await admin.from("admin_users").select("user_id,role").eq("user_id", uid).maybeSingle();
      if (!row) return reply(404, { error: "Trabajador no encontrado" });
      const patch = body.patch || {};
      if (uid === actor.id && (patch.active === false || (patch.role && patch.role !== "owner"))) {
        return reply(400, { error: "No puedes desactivarte ni quitarte el rol de propietario a ti mismo" });
      }
      if (patch.role && patch.role !== row.role && row.role === "owner") {
        const { count } = await admin.from("admin_users").select("user_id", { count: "exact", head: true }).eq("role", "owner");
        if ((count || 0) <= 1) return reply(400, { error: "Debe quedar al menos un propietario" });
      }
      if (patch.role) {
        if (!ROLES.includes(patch.role)) return reply(400, { error: "Rol no válido" });
        const { error } = await admin.from("admin_users").update({ role: patch.role }).eq("user_id", uid);
        if (error) throw error;
      }
      const prof: Record<string, unknown> = { user_id: uid, updated_at: new Date().toISOString() };
      if (typeof patch.display_name === "string") prof.display_name = patch.display_name.trim().slice(0, 60);
      if (typeof patch.active === "boolean") prof.active = patch.active;
      if (patch.permissions) prof.permissions = cleanPerms(patch.permissions);
      if (Object.keys(prof).length > 2) {
        const { error } = await admin.from("staff_profiles").upsert(prof);
        if (error) throw error;
      }
      if (typeof patch.active === "boolean") {
        // Desactivar también cierra el acceso a nivel de autenticación.
        await admin.auth.admin.updateUserById(uid, { ban_duration: patch.active ? "none" : "876000h" });
      }
      if (patch.password) {
        if (String(patch.password).length < 10) return reply(400, { error: "La contraseña debe tener al menos 10 caracteres" });
        const { error } = await admin.auth.admin.updateUserById(uid, { password: String(patch.password) });
        if (error) return reply(400, { error: "No se pudo cambiar la contraseña" });
      }
      return reply(200, { ok: true });
    }
    return reply(400, { error: "Acción no válida" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudo gestionar el equipo" });
  }
});
