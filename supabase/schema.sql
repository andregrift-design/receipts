-- VH5: run this once in Supabase (project "receipts"): SQL Editor > New query > paste > Run.
-- Safe to run again.

-- ---------- receipts ----------

create table if not exists public.receipts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  file_path    text,                       -- "<user_id>/<id>.jpg" in the receipts bucket
  file_type    text,                       -- image/jpeg, application/pdf, ...
  doc_type     text        not null default 'receipt'  -- receipt | invoice | payment (payment receipt only) | none (entered by hand)
               constraint receipts_doc_type check (doc_type in ('receipt', 'invoice', 'payment', 'none')),
  status       text        not null default 'processing'
               check (status in ('processing', 'review', 'done', 'error')),
  store        text,
  store_address text,                     -- as printed on the receipt; basis for the country
  description  text,
  category     text,
  receipt_date date,
  currency     text        not null default 'EUR',
  total        numeric(12,2),              -- amount paid, VAT included, in the receipt currency
  vat_country  text        not null default 'NL',  -- country of the store; foreign VAT is reported separately
  vat_lines    jsonb       not null default '[]',  -- [{rate: 21 | 9 | 0 | null (no VAT), net, vat}]
  fx_rate      numeric(14,6),              -- EUR for 1 unit of currency (ECB, receipt date)
  fx_date      date,                       -- date of that rate: the receipt date, or the last business day before it
  notes        text,
  annual_only  boolean     not null default false,  -- annual cost only, not on the VAT return
  issues       jsonb       not null default '[]',  -- what the reader was unsure about
  extraction   jsonb,                      -- raw result from the reader
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists receipts_user_date on public.receipts (user_id, receipt_date);

create or replace function public.receipts_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists receipts_touch on public.receipts;
create trigger receipts_touch before update on public.receipts
  for each row execute function public.receipts_touch();

-- ---------- sharing (read-only access for your accountant) ----------

create table if not exists public.shares (
  owner_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  owner_email  text        not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  viewer_email text        not null check (viewer_email = lower(viewer_email)),
  created_at   timestamptz not null default now(),
  primary key (owner_id, viewer_email)
);

-- True when the signed-in user owns the data or it was shared with their (confirmed) email.
create or replace function public.can_view(p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()::text
      or exists (
        select 1 from public.shares s
        where s.owner_id::text = p_owner
          and s.viewer_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      );
$$;

alter table public.receipts enable row level security;
alter table public.shares   enable row level security;

drop policy if exists "read own or shared" on public.receipts;
create policy "read own or shared" on public.receipts
  for select using (public.can_view(user_id::text));

drop policy if exists "write own" on public.receipts;
create policy "write own" on public.receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner manages shares" on public.shares;
create policy "owner manages shares" on public.shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "viewer sees own shares" on public.shares;
create policy "viewer sees own shares" on public.shares
  for select using (viewer_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Live updates between devices.
do $$ begin
  alter publication supabase_realtime add table public.receipts;
exception when duplicate_object then null; end $$;

-- ---------- photos (private bucket, one folder per user) ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts read own or shared" on storage.objects;
create policy "receipts read own or shared" on storage.objects
  for select using (bucket_id = 'receipts' and public.can_view(split_part(name, '/', 1)));

drop policy if exists "receipts insert own" on storage.objects;
create policy "receipts insert own" on storage.objects
  for insert with check (bucket_id = 'receipts' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "receipts update own" on storage.objects;
create policy "receipts update own" on storage.objects
  for update using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "receipts delete own" on storage.objects;
create policy "receipts delete own" on storage.objects
  for delete using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth.uid()::text);

-- ---------- agency statements (income) ----------

create table if not exists public.statements (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null default auth.uid() references auth.users on delete cascade,
  file_path      text,                       -- "<user_id>/st-<id>.pdf" in the receipts bucket
  file_type      text,
  status         text        not null default 'processing'
                 check (status in ('processing', 'review', 'done')),
  agency         text,
  agency_country text        not null default 'NL',
  agency_address text,
  statement_no   text,
  statement_date date,                       -- payment date; amounts are converted at this date
  currency       text        not null default 'EUR',
  fx_rate        numeric(14,6),              -- EUR for 1 unit of currency (ECB, statement date)
  fx_date        date,
  -- [{date, job_date, client, description, invoice_no, kind, fee, vat_rate, vat, expenses,
  --   deductions: [{type: agency_fee|website|transport|tax_withheld|other, label, amount, vat}], total}]
  lines          jsonb       not null default '[]',
  total_paid     numeric(12,2),
  notes          text,
  issues         jsonb       not null default '[]',
  extraction     jsonb,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists statements_user_date on public.statements (user_id, statement_date);

drop trigger if exists statements_touch on public.statements;
create trigger statements_touch before update on public.statements
  for each row execute function public.receipts_touch();

alter table public.statements enable row level security;

drop policy if exists "read own or shared" on public.statements;
create policy "read own or shared" on public.statements
  for select using (public.can_view(user_id::text));

drop policy if exists "write own" on public.statements;
create policy "write own" on public.statements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.statements;
exception when duplicate_object then null; end $$;

-- ---------- periods: quarters filed with the CPA are locked ----------

alter table public.statements add column if not exists booking_date date;   -- entered by the user; decides the quarter
alter table public.receipts   add column if not exists period text;         -- 'YYYY-Qn', set by the trigger below
alter table public.statements add column if not exists period text;
alter table public.receipts   add column if not exists annual_only boolean not null default false;
alter table public.receipts   add column if not exists corrects uuid references public.receipts on delete set null;
alter table public.statements add column if not exists corrects uuid references public.statements on delete set null;

create table if not exists public.periods (
  user_id   uuid        not null default auth.uid() references auth.users on delete cascade,
  period    text        not null check (period ~ '^\d{4}-Q[1-4]$'),
  filed_at  timestamptz not null default now(),
  note      text,
  primary key (user_id, period)
);
alter table public.periods enable row level security;
drop policy if exists "read own or shared" on public.periods;
create policy "read own or shared" on public.periods for select using (public.can_view(user_id::text));
drop policy if exists "file own" on public.periods;
create policy "file own" on public.periods for insert with check (auth.uid() = user_id);
-- No update or delete policy: a filed quarter stays filed.

create or replace function public.is_filed(p_user uuid, p_period text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.periods where user_id = p_user and period = p_period);
$$;

create or replace function public.next_period(p text) returns text language sql immutable as $$
  select case when right(p, 1) = '4' then (left(p, 4)::int + 1)::text || '-Q1'
              else left(p, 6) || (right(p, 1)::int + 1)::text end;
$$;

-- Records in a filed quarter cannot change. New or changed records get the quarter of their date
-- (receipt date / booking date); if that quarter is filed, the first open quarter after it.
create or replace function public.assign_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; p text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.period is not null and public.is_filed(old.user_id, old.period) then
    raise exception 'VH5: % has been filed with the CPA. Make a correction instead.', old.period;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- Separate statements: each table only has its own date column.
  if tg_table_name = 'receipts' then d := new.receipt_date; else d := new.booking_date; end if;
  if d is null then new.period := null; return new; end if;
  p := to_char(d, 'YYYY') || '-Q' || to_char(d, 'Q');
  while public.is_filed(new.user_id, p) loop p := public.next_period(p); end loop;
  new.period := p;
  return new;
end $$;

drop trigger if exists receipts_period on public.receipts;
create trigger receipts_period before insert or update or delete on public.receipts
  for each row execute function public.assign_period();
drop trigger if exists statements_period on public.statements;
create trigger statements_period before insert or update or delete on public.statements
  for each row execute function public.assign_period();

do $$ begin
  alter publication supabase_realtime add table public.periods;
exception when duplicate_object then null; end $$;

-- Fill period for existing rows.
update public.receipts set receipt_date = receipt_date where period is null and receipt_date is not null;
update public.statements set booking_date = booking_date where period is null and booking_date is not null;
