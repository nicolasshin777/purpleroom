-- СпектрОптик CRM — таблицы в общей базе rusprint.
-- Запускать в SQL-консоли базы ПОСЛЕ включения Data API и Авторизации.
-- Скрипт можно запускать повторно: он ничего не удаляет и не трогает данные.

-- ─── 1. Таблицы типографии закрываем от Data API ───────────────────────────
-- anon и authenticated — роли посетителей сайта в Data API. Сервер rusprint
-- подключается к базе своей ролью, поэтому эти строки его не затрагивают.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ─── 2. Таблицы СпектрОптика (префикс spo_) ─────────────────────────────────
create table if not exists public.spo_members (
  user_id    uuid primary key,
  email      text,
  name       text not null default '',
  role       text not null default 'pending' check (role in ('producer', 'editor', 'client', 'pending')),
  color      text not null default '#3546E0',
  created_at timestamptz not null default now()
);

-- Проекты правок (kind = 'project') и общий документ CRM: выпуски, задачи, цели (id = 'crm')
create table if not exists public.spo_docs (
  id         text primary key,
  kind       text not null check (kind in ('project', 'crm')),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Ключи YouTube и токен Telegram — их видит только продюсер
create table if not exists public.spo_secrets (
  id         text primary key default 'main',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.spo_members enable row level security;
alter table public.spo_docs    enable row level security;
alter table public.spo_secrets enable row level security;

-- ─── 3. Роль текущего пользователя ─────────────────────────────────────────
create or replace function public.spo_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.spo_members where user_id = auth.uid()
$$;

-- Вступление в команду: первый вошедший — продюсер, остальные ждут подтверждения
create or replace function public.spo_join(p_name text default '', p_email text default '')
returns public.spo_members
language plpgsql security definer set search_path = public as $$
declare
  m public.spo_members;
  v_email text;
  n int;
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  select * into m from public.spo_members where user_id = auth.uid();
  if found then return m; end if;
  begin
    select email into v_email from auth.users where id = auth.uid();
  exception when others then v_email := null;
  end;
  v_email := coalesce(v_email, nullif(trim(p_email), ''));
  select count(*) into n from public.spo_members;
  insert into public.spo_members (user_id, email, name, role, color)
  values (
    auth.uid(), v_email,
    coalesce(nullif(trim(p_name), ''), split_part(coalesce(v_email, ''), '@', 1)),
    case when exists (select 1 from public.spo_members where role = 'producer') then 'pending' else 'producer' end,
    (array['#3546E0','#E5484D','#22A06B','#8E4EC6','#F2711C','#12A5A5','#D6409F'])[1 + n % 7]
  )
  returning * into m;
  return m;
end $$;

-- Роль меняет только продюсер; себе — имя и цвет
create or replace function public.spo_members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'Нельзя менять пользователя'; end if;
  if new.role is distinct from old.role and coalesce(public.spo_role(), '') <> 'producer' then
    raise exception 'Роль меняет только продюсер';
  end if;
  return new;
end $$;
drop trigger if exists spo_members_guard on public.spo_members;
create trigger spo_members_guard before update on public.spo_members
  for each row execute function public.spo_members_guard();

create or replace function public.spo_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists spo_docs_touch on public.spo_docs;
create trigger spo_docs_touch before insert or update on public.spo_docs
  for each row execute function public.spo_touch();

-- ─── 4. Кто что видит (RLS) ────────────────────────────────────────────────
drop policy if exists spo_members_read   on public.spo_members;
drop policy if exists spo_members_update on public.spo_members;
drop policy if exists spo_members_delete on public.spo_members;
create policy spo_members_read on public.spo_members for select to authenticated
  using (user_id = auth.uid() or public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_members_update on public.spo_members for update to authenticated
  using (user_id = auth.uid() or public.spo_role() = 'producer')
  with check (user_id = auth.uid() or public.spo_role() = 'producer');
create policy spo_members_delete on public.spo_members for delete to authenticated
  using (public.spo_role() = 'producer' and user_id <> auth.uid());

drop policy if exists spo_docs_read   on public.spo_docs;
drop policy if exists spo_docs_insert on public.spo_docs;
drop policy if exists spo_docs_update on public.spo_docs;
drop policy if exists spo_docs_delete on public.spo_docs;
create policy spo_docs_read on public.spo_docs for select to authenticated
  using (public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_docs_insert on public.spo_docs for insert to authenticated
  with check (public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_docs_update on public.spo_docs for update to authenticated
  using (public.spo_role() in ('producer', 'editor', 'client'))
  with check (public.spo_role() in ('producer', 'editor', 'client'));
create policy spo_docs_delete on public.spo_docs for delete to authenticated
  using (public.spo_role() = 'producer');

drop policy if exists spo_secrets_all on public.spo_secrets;
create policy spo_secrets_all on public.spo_secrets for all to authenticated
  using (public.spo_role() = 'producer')
  with check (public.spo_role() = 'producer');

-- ─── 5. Права ролей Data API — только на таблицы СпектрОптика ──────────────
revoke all on public.spo_members, public.spo_docs, public.spo_secrets from anon;
grant select, update, delete         on public.spo_members to authenticated;
grant select, insert, update, delete on public.spo_docs    to authenticated;
grant select, insert, update, delete on public.spo_secrets to authenticated;

revoke all on function public.spo_join(text, text)    from public, anon;
revoke all on function public.spo_role()              from public, anon;
grant execute on function public.spo_join(text, text) to authenticated;
grant execute on function public.spo_role()           to authenticated;
