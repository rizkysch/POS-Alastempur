-- ALASTEMPUR POS v3 - Supabase SQL
-- Jalankan SELURUH script ini di Supabase Dashboard -> SQL Editor.
-- Jangan masukkan service_role/secret key ke aplikasi browser.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Operator',
  phone varchar(14),
  role text not null default 'kasir' check (role in ('admin','kasir','pegawai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_format check (phone is null or phone ~ '^[0-9]{10,14}$')
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price numeric(14,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_name text not null,
  phone varchar(14) not null,
  notes text,
  status text not null default 'baru' check (status in ('baru','diproses','dicuci','dikeringkan','quality_check','siap_diambil','selesai')),
  payment_method text not null default 'cash' check (payment_method in ('cash','transfer','qris')),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint orders_phone_format check (phone ~ '^[0-9]{10,14}$'),
  constraint orders_paid_not_over_total check (paid_amount <= total)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  quantity integer not null check (quantity >= 1),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,'operator'),'@',1)),
    nullif(new.raw_user_meta_data->>'phone','')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.limit_order_items()
returns trigger
language plpgsql
as $$
declare
  item_count integer;
begin
  select count(*) into item_count from public.order_items where order_id = new.order_id;
  if item_count >= 5 then
    raise exception 'Maksimal 5 layanan per pesanan';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limit_order_items on public.order_items;
create trigger trg_limit_order_items
before insert on public.order_items
for each row execute procedure public.limit_order_items();

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "services_authenticated_select" on public.services;
create policy "services_authenticated_select" on public.services for select to authenticated using (true);
drop policy if exists "services_authenticated_insert" on public.services;
create policy "services_authenticated_insert" on public.services for insert to authenticated with check (true);
drop policy if exists "services_authenticated_update" on public.services;
create policy "services_authenticated_update" on public.services for update to authenticated using (true) with check (true);

drop policy if exists "orders_authenticated_select" on public.orders;
create policy "orders_authenticated_select" on public.orders for select to authenticated using (true);
drop policy if exists "orders_authenticated_insert" on public.orders;
create policy "orders_authenticated_insert" on public.orders for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "orders_authenticated_update" on public.orders;
create policy "orders_authenticated_update" on public.orders for update to authenticated using (true) with check (true);
drop policy if exists "orders_authenticated_delete" on public.orders;
create policy "orders_authenticated_delete" on public.orders for delete to authenticated using (true);

drop policy if exists "items_authenticated_select" on public.order_items;
create policy "items_authenticated_select" on public.order_items for select to authenticated using (true);
drop policy if exists "items_authenticated_insert" on public.order_items;
create policy "items_authenticated_insert" on public.order_items for insert to authenticated with check (true);
drop policy if exists "items_authenticated_update" on public.order_items;
create policy "items_authenticated_update" on public.order_items for update to authenticated using (true) with check (true);
drop policy if exists "items_authenticated_delete" on public.order_items;
create policy "items_authenticated_delete" on public.order_items for delete to authenticated using (true);

-- Seed layanan awal. Aman dijalankan berulang kali.
insert into public.services (name, price, active) values
('Fast Clean', 25000, true),
('Deep Clean', 40000, true),
('Unyellowing', 50000, true),
('Repaint', 75000, true)
on conflict (name) do nothing;

-- Realtime untuk Kanban/dashboard.
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null;
end $$;

-- Setelah akun pertama berhasil REGISTER, ambil UUID user dari
-- Supabase -> Authentication -> Users lalu jadikan admin dengan:
-- update public.profiles set role='admin' where id='UUID_USER';
