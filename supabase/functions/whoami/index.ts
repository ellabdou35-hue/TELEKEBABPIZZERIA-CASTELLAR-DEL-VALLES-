// Devuelve la identidad, el rol y los permisos efectivos del usuario del panel.
import { adminClient, cors, getActor, reply } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    return reply(200, { user_id: actor.id, email: actor.email, display_name: actor.name, role: actor.role, permissions: actor.permissions });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudo comprobar la sesión" });
  }
});
