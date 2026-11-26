-- Alastempur: superadmin, cashier invitations, profile, active accounts and audit log.
-- Run in Supabase SQL Editor after selecting the same project used by js/config.js.
-- Safe to re-run. Does not delete existing orders or accounts.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Operator',
  phone varchar(14),
  email text,
  role text not null default 'kasir',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text not null default 'Operator';
alter table public.profiles add column if not exists phone varchar(14);
alter table public.profiles add column if not exists role text not null default 'kasir';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists customer_name text;
alter table public.services add column if not exists active boolean not null default true;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is distinct from u.email;

insert into public.profiles (id, full_name, phone, email)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), split_part(coalesce(u.email,'operator'),'@',1)),
  nullif(u.raw_user_meta_data->>'phone',''),
  u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

update public.profiles
set full_name = coalesce(nullif(left(trim(full_name), 100), ''), 'Operator')
where full_name is null or char_length(trim(full_name)) < 2 or char_length(trim(full_name)) > 100;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_allowed;
alter table public.profiles add constraint profiles_role_allowed
  check (role in ('superadmin','admin','kasir','pegawai'));
alter table public.profiles drop constraint if exists profiles_phone_format;
alter table public.profiles add constraint profiles_phone_format
  check (phone is null or phone ~ '^[0-9]{10,14}$');
alter table public.profiles drop constraint if exists profiles_full_name_format;
alter table public.profiles add constraint profiles_full_name_format
  check (char_length(trim(full_name)) between 2 and 100);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists profiles_role_active_idx on public.profiles (role, is_active);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, email, role, is_active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,'operator'),'@',1)),
    nullif(new.raw_user_meta_data->>'phone',''),
    new.email,
    'kasir',
    true
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin' and is_active = true
  );
$$;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_superadmin() to authenticated;

create or replace function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_touch_profile_updated_at on public.profiles;
create trigger trg_touch_profile_updated_at
before update on public.profiles
for each row execute procedure public.touch_profile_updated_at();

create or replace function public.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changes jsonb := '{}'::jsonb;
begin
  if old.full_name is distinct from new.full_name then
    changes := changes || jsonb_build_object('full_name', jsonb_build_object('from', old.full_name, 'to', new.full_name));
  end if;
  if old.phone is distinct from new.phone then
    changes := changes || jsonb_build_object('phone', jsonb_build_object('from', old.phone, 'to', new.phone));
  end if;
  if changes <> '{}'::jsonb and auth.uid() is not null then
    insert into public.audit_logs(actor_id, action, target_user_id, details)
    values (auth.uid(), 'profile.updated', new.id, changes);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_profile_update on public.profiles;
create trigger trg_audit_profile_update
after update on public.profiles
for each row execute procedure public.audit_profile_update();

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_logs enable row level security;

-- Remove prior permissive policies so they cannot bypass the new active-user rules.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','services','orders','order_items','audit_logs')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

create policy profiles_read_self_or_superadmin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_superadmin());
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid() and public.is_active_user());

create policy services_active_select on public.services
  for select to authenticated using (public.is_active_user());
create policy services_active_insert on public.services
  for insert to authenticated with check (public.is_active_user());
create policy services_active_update on public.services
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());

create policy orders_active_select on public.orders
  for select to authenticated using (public.is_active_user());
create policy orders_active_insert on public.orders
  for insert to authenticated with check (public.is_active_user() and created_by = auth.uid());
create policy orders_active_update on public.orders
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy orders_active_delete on public.orders
  for delete to authenticated using (public.is_active_user());

create policy order_items_active_select on public.order_items
  for select to authenticated using (public.is_active_user());
create policy order_items_active_insert on public.order_items
  for insert to authenticated with check (public.is_active_user());
create policy order_items_active_update on public.order_items
  for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy order_items_active_delete on public.order_items
  for delete to authenticated using (public.is_active_user());

create policy audit_logs_superadmin_select on public.audit_logs
  for select to authenticated using (public.is_superadmin());

-- Bootstrap the first superadmin manually in SQL Editor after confirming the UUID:
-- update public.profiles set role = 'superadmin' where id = 'AUTH_USER_UUID';
