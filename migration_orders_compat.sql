-- Reconcile an older orders/order_items schema with the columns used by js/app.js.
-- Additive and re-runnable; existing orders are preserved.

create extension if not exists pgcrypto;

alter table public.orders add column if not exists order_code text;
alter table public.orders add column if not exists invoice_number text;
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists phone varchar(14);
alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists status text not null default 'baru';
alter table public.orders add column if not exists payment_method text not null default 'cash';
alter table public.orders add column if not exists paid_amount numeric(14,2) not null default 0;
alter table public.orders add column if not exists payment_amount numeric(14,2) not null default 0;
alter table public.orders add column if not exists payment_status text not null default 'BELUM LUNAS';
alter table public.orders add column if not exists total numeric(14,2) not null default 0;
alter table public.orders add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists completed_at timestamptz;

-- Normalize legacy enum values (Tunai/Transfer/QRIS) to the values sent by the app.
-- Drop/reapply the default so changing an enum column to text is safe.
alter table public.orders alter column payment_method drop default;
alter table public.orders alter column payment_method type text using (
  case lower(payment_method::text)
    when 'tunai' then 'cash'
    else lower(payment_method::text)
  end
);
alter table public.orders alter column payment_method set default 'cash';
alter table public.orders drop constraint if exists orders_payment_method_allowed;
alter table public.orders add constraint orders_payment_method_allowed
  check (payment_method in ('cash', 'transfer', 'qris'));

-- Give historical rows a stable code when this field did not exist before.
update public.orders
set order_code = 'ALT-LEGACY-' || upper(replace(id::text, '-', ''))
where order_code is null or btrim(order_code) = '';

-- Repair duplicate legacy codes before enforcing uniqueness.
with ranked_codes as (
  select ctid, row_number() over (partition by order_code order by created_at, id) as row_num
  from public.orders
)
update public.orders o
set order_code = 'ALT-LEGACY-' || upper(replace(o.id::text, '-', ''))
from ranked_codes r
where o.ctid = r.ctid and r.row_num > 1;

update public.orders
set invoice_number = order_code
where invoice_number is null or btrim(invoice_number) = '';

alter table public.orders alter column order_code set not null;
create unique index if not exists orders_order_code_compat_uidx on public.orders (order_code);
alter table public.orders alter column invoice_number set not null;
create unique index if not exists orders_invoice_number_compat_uidx on public.orders (invoice_number);

alter table public.order_items add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.order_items add column if not exists service_id uuid references public.services(id) on delete set null;
alter table public.order_items add column if not exists shoe_name text;
alter table public.order_items add column if not exists brand text;
alter table public.order_items add column if not exists color text;
alter table public.order_items add column if not exists material text;
alter table public.order_items add column if not exists condition_notes text;
alter table public.order_items add column if not exists service_name text;
alter table public.order_items add column if not exists quantity integer not null default 1;
alter table public.order_items add column if not exists unit_price numeric(14,2) not null default 0;
alter table public.order_items add column if not exists subtotal numeric(14,2) not null default 0;
alter table public.order_items add column if not exists created_at timestamptz not null default now();

notify pgrst, 'reload schema';
