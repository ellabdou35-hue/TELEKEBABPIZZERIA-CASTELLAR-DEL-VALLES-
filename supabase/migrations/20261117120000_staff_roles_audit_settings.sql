-- =====================================================================
-- Tele Kebab Pizzería · Migración ADITIVA (no borra ni modifica datos existentes)
-- Proyecto Supabase: zifzljhewpimjjulbyqx (Telekebabpizzeria)
--
-- PREPARADA, NO APLICADA. Requiere autorización expresa del propietario.
--
-- Añade:
--   1. Perfiles de trabajador (nombre visible, activo, permisos).
--   2. Registro de actividad de pedidos (quién cambió qué estado y cuándo).
--   3. Configuración de la web (horario, aviso, pausa de pedidos).
--   4. Columnas opcionales: foto de producto, hora estimada y motivo de cancelación.
--   5. Lectura de pedidos para trabajadores autenticados (activa el tiempo real
--      del panel de cocina, que hoy cae siempre a consulta periódica).
--   6. Bucket público de fotos de productos (sólo lectura pública; la subida se
--      hace con URL firmada desde la Edge Function admin-menu).
-- =====================================================================

begin;

-- 1. Perfiles de trabajador ------------------------------------------------
create table if not exists public.staff_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  active       boolean not null default true,
  permissions  jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
-- Sin políticas: sólo se accede con la service role desde Edge Functions.

-- Perfil para las cuentas existentes (no cambia su rol ni sus permisos).
insert into public.staff_profiles (user_id, display_name)
select a.user_id, coalesce(split_part(u.email, '@', 1), '')
from public.admin_users a join auth.users u on u.id = a.user_id
on conflict (user_id) do nothing;

-- Roles admitidos. NOT VALID para no fallar si existiese un valor antiguo;
-- después se valida (los 2 usuarios actuales son 'owner').
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_users_role_check') then
    alter table public.admin_users add constraint admin_users_role_check
      check (role in ('owner', 'manager', 'staff')) not valid;
  end if;
end $$;
alter table public.admin_users validate constraint admin_users_role_check;

-- Función auxiliar: ¿el usuario actual es trabajador activo?
create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_users a
    left join public.staff_profiles s on s.user_id = a.user_id
    where a.user_id = auth.uid() and coalesce(s.active, true)
  );
$$;
revoke all on function public.is_active_staff() from public;
grant execute on function public.is_active_staff() to authenticated;

-- 2. Registro de actividad de pedidos -------------------------------------
create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_name  text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);
create index if not exists order_events_created_idx on public.order_events (created_at desc);
alter table public.order_events enable row level security;

-- 3. Configuración de la web ------------------------------------------------
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.site_settings enable row level security;
drop policy if exists "Public can read public settings" on public.site_settings;
create policy "Public can read public settings" on public.site_settings
  for select to anon, authenticated using (key = 'public');
grant select on public.site_settings to anon, authenticated;

insert into public.site_settings (key, value) values ('public', jsonb_build_object(
  'hours', jsonb_build_array(
    jsonb_build_object('from', '11:30', 'to', '16:00'),
    jsonb_build_object('from', '18:00', 'to', '23:00')),
  'announcement', '',
  'ordering_paused', false
)) on conflict (key) do nothing;

-- 4. Columnas opcionales -----------------------------------------------------
alter table public.products add column if not exists image_url text;
alter table public.orders   add column if not exists estimated_ready_at timestamptz;
alter table public.orders   add column if not exists cancel_reason text;
alter table public.orders   add column if not exists handled_by uuid references auth.users(id) on delete set null;

-- 5. Lectura de pedidos para trabajadores (tiempo real) ----------------------
drop policy if exists "Active staff can read orders" on public.orders;
create policy "Active staff can read orders" on public.orders
  for select to authenticated using (public.is_active_staff());
grant select on public.orders to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

-- 6. Fotos de productos -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 3145728, array['image/webp', 'image/jpeg', 'image/png', 'image/avif'])
on conflict (id) do nothing;

commit;
