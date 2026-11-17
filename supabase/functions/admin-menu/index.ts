// Gestión de la carta.
//  - Cuerpo vacío o GET: lista completa (incluye productos ocultos).
//  - Guardar producto (crear/editar): permiso menu_edit. Guarda TODOS los campos que envía el
//    panel (familia, orden, personalización, estado de revisión, foto…). La versión 2 en
//    producción descartaba familia, orden y personalización: este es el arreglo.
//  - Sólo disponibilidad ({id, active}): permiso stock (trabajadores de cocina).
//  - {action:"upload_url", filename}: URL firmada para subir una foto (menu_edit).
//  - No se borran productos: se ocultan o se archivan (los pedidos antiguos los referencian).
import { adminClient, cors, deny, getActor, reply } from "../_shared/auth.ts";

const SOURCE = ["legacy", "preliminary", "size_price_preliminary", "price_confirmed_size_pending"];
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function validConfig(c: unknown): string {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "La personalización debe ser un objeto JSON";
  const cfg = c as Record<string, unknown>;
  if (JSON.stringify(cfg).length > 8000) return "La personalización es demasiado grande";
  if (cfg.size_required) {
    if (!Array.isArray(cfg.sizes) || !cfg.sizes.length) return "Indica al menos un tamaño";
    for (const s of cfg.sizes as Array<Record<string, unknown>>) {
      if (!s || !String(s.name || "").trim() || !Number.isFinite(Number(s.price)) || Number(s.price) < 0 || Number(s.price) > 1000) return "Tamaño no válido";
    }
  }
  for (const k of ["extra_sauce_price", "extra_ingredient_price", "extra_cheese_price", "drink_base_price"]) {
    if (cfg[k] != null && (!Number.isFinite(Number(cfg[k])) || Number(cfg[k]) < 0 || Number(cfg[k]) > 100)) return "Precio de extra no válido: " + k;
  }
  for (const k of ["meat_options", "side_options", "sauce_choice_options", "extra_sauce_options", "extra_ingredient_options", "ingredients", "drink_options", "style_options", "pizza_flavor_options"]) {
    if (cfg[k] != null && (!Array.isArray(cfg[k]) || (cfg[k] as unknown[]).some((x) => typeof x !== "string" || x.length > 80))) return "Lista no válida: " + k;
  }
  for (const k of ["bundle_count", "pizza_count", "drink_count"]) {
    if (cfg[k] != null && (!Number.isInteger(Number(cfg[k])) || Number(cfg[k]) < 1 || Number(cfg[k]) > 10)) return "Cantidad no válida: " + k;
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = adminClient();
    const actor = await getActor(req, admin);
    if (actor instanceof Response) return actor;
    const raw = req.method === "POST" ? await req.text() : "";
    if (req.method === "GET" || !raw.trim()) {
      const { data, error } = await admin.from("products").select("*").order("sort_order").order("name");
      if (error) throw error;
      return reply(200, { products: data, permissions: actor.permissions });
    }
    if (req.method !== "POST") return reply(405, { error: "Método no permitido" });
    const body = JSON.parse(raw);

    if (body.action === "upload_url") {
      if (!actor.can("menu_edit")) return deny("menu_edit");
      const ext = String(body.filename || "").toLowerCase().match(/\.(webp|jpe?g|png|avif)$/)?.[1];
      if (!ext) return reply(400, { error: "Formato no admitido (WebP, JPG, PNG o AVIF)" });
      const path = `productos/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await admin.storage.from("product-images").createSignedUploadUrl(path);
      if (error) return reply(503, { error: "El almacén de fotos aún no está activado" });
      const { data: pub } = admin.storage.from("product-images").getPublicUrl(path);
      return reply(200, { upload_url: data.signedUrl, token: data.token, path, public_url: pub.publicUrl });
    }

    const keys = Object.keys(body).filter((k) => body[k] !== undefined);
    const onlyStock = body.id && keys.every((k) => k === "id" || k === "active");
    if (onlyStock) {
      if (!actor.can("stock") && !actor.can("menu_edit")) return deny("stock");
      const { data, error } = await admin.from("products").update({ active: body.active === true, updated_at: new Date().toISOString() }).eq("id", body.id).select("*").single();
      if (error) throw error;
      return reply(200, { ok: true, product: data });
    }
    // El panel de cocina envía el producto completo al marcar agotado: si sólo cambia "active"
    // y el usuario no puede editar la carta, se trata como cambio de disponibilidad.
    if (!actor.can("menu_edit")) {
      if (!body.id || !actor.can("stock")) return deny("menu_edit");
      const { data: cur } = await admin.from("products").select("*").eq("id", body.id).maybeSingle();
      if (!cur) return reply(404, { error: "Producto no encontrado" });
      const changed = ["name", "family", "category", "price", "description", "emoji", "sort_order"].some((k) => body[k] !== undefined && String(body[k]) !== String(cur[k]));
      if (changed) return deny("menu_edit");
      const { data, error } = await admin.from("products").update({ active: body.active === true, updated_at: new Date().toISOString() }).eq("id", body.id).select("*").single();
      if (error) throw error;
      return reply(200, { ok: true, product: data });
    }

    const name = str(body.name, 100), category = str(body.category, 60), family = str(body.family || "Otros", 60);
    const price = Number(body.price), sort = body.sort_order == null ? 100 : Number(body.sort_order);
    if (!name || !category || !family || !Number.isFinite(price) || price < 0 || price > 1000) return reply(400, { error: "Nombre, familia, categoría o precio no válido" });
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) return reply(400, { error: "Orden no válido" });
    const config = body.customization_config ?? {};
    const cfgErr = validConfig(config);
    if (cfgErr) return reply(400, { error: cfgErr });
    const image = body.image_url == null ? undefined : str(body.image_url, 500);
    if (image && !/^https:\/\//.test(image)) return reply(400, { error: "La foto debe ser una URL https" });

    const values: Record<string, unknown> = {
      name, family, category, price, sort_order: sort,
      description: str(body.description, 300), emoji: str(body.emoji || "🍽️", 8),
      active: body.active === true, customization_config: config,
      source_status: SOURCE.includes(body.source_status) ? body.source_status : "legacy",
      source_note: str(body.source_note, 800), updated_at: new Date().toISOString(),
    };
    if (image !== undefined) values.image_url = image || null;
    const run = (v: Record<string, unknown>) => body.id
      ? admin.from("products").update(v).eq("id", body.id).select("*").single()
      : admin.from("products").insert(v).select("*").single();
    let result = await run(values);
    if (result.error && /image_url/.test(result.error.message)) { delete values.image_url; result = await run(values); }
    if (result.error) throw result.error;
    return reply(200, { ok: true, product: result.data });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "No se pudo actualizar la carta" });
  }
});
