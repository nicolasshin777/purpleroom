-- СпектрОптик: доступы, выданные заранее (запускать в SQL-редакторе базы rusprint).
-- Можно запускать повторно. Типографию не трогает.

-- Доступы, выданные продюсером заранее: почта → роль. Человек регистрируется с этой
-- почтой и сразу получает роль; запись после этого удаляется.
create table if not exists public.spo_invites (
  email      text primary key check (email = lower(email)),
  role       text not null check (role in ('editor', 'client')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.spo_invites enable row level security;

-- Вступление в команду. Роль — только по почте, подтверждённой при входе
-- (из auth.users или токена), а не по адресу, который прислал браузер:
-- почта админа → продюсер, почта из выданных доступов → её роль, остальные ждут.
create or replace function public.spo_join(p_name text default '', p_email text default '')
returns public.spo_members
language plpgsql security definer set search_path = public as $$
declare
  m public.spo_members;
  v_email text;
  v_role text;
  n int;
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  begin
    select email into v_email from auth.users where id = auth.uid();
  exception when others then v_email := null;
  end;
  if v_email is null then
    begin
      v_email := auth.jwt() ->> 'email';
    exception when others then v_email := null;
    end;
  end if;
  v_email := lower(v_email);
  v_role := case when v_email = public.spo_admin_email() then 'producer'
                 else (select i.role from public.spo_invites i where i.email = v_email) end;
  select * into m from public.spo_members where user_id = auth.uid();
  if found then
    if v_role is not null and (m.role = 'pending' or (v_role = 'producer' and m.role <> 'producer')) then
      perform set_config('spo.join', '1', true);
      update public.spo_members set role = v_role where user_id = auth.uid() returning * into m;
      perform set_config('spo.join', '', true);
    end if;
  else
    select count(*) into n from public.spo_members;
    insert into public.spo_members (user_id, email, name, role, color)
    values (
      auth.uid(), coalesce(v_email, nullif(lower(trim(p_email)), '')),
      coalesce(nullif(trim(p_name), ''), split_part(coalesce(v_email, p_email, ''), '@', 1)),
      coalesce(v_role, 'pending'),
      (array['#3546E0','#E5484D','#22A06B','#8E4EC6','#F2711C','#12A5A5','#D6409F'])[1 + n % 7]
    )
    returning * into m;
  end if;
  if v_role is not null and v_role <> 'producer' then delete from public.spo_invites where email = v_email; end if;
  return m;
end $$;

drop policy if exists spo_invites_all on public.spo_invites;
create policy spo_invites_all on public.spo_invites for all to authenticated
  using (public.spo_role() = 'producer')
  with check (public.spo_role() = 'producer');

revoke all on public.spo_invites from anon;
grant select, insert, update, delete on public.spo_invites to authenticated;
revoke all on function public.spo_join(text, text) from public, anon;
grant execute on function public.spo_join(text, text) to authenticated;
