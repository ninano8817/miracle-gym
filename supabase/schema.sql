-- Miracle GYM 스키마
-- docs: 사용자별 문서 저장 (key 예: day:2026-11-10, health:2026-11-10, settings, history2024)
create table if not exists public.docs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.docs enable row level security;
drop policy if exists "docs_select_own" on public.docs;
drop policy if exists "docs_insert_own" on public.docs;
drop policy if exists "docs_update_own" on public.docs;
drop policy if exists "docs_delete_own" on public.docs;
create policy "docs_select_own" on public.docs for select to authenticated using (user_id = (select auth.uid()));
create policy "docs_insert_own" on public.docs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "docs_update_own" on public.docs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "docs_delete_own" on public.docs for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.docs from anon;
grant select, insert, update, delete on public.docs to authenticated;

-- 단축어 연동 키
create table if not exists public.ingest_tokens (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table public.ingest_tokens enable row level security;
drop policy if exists "tokens_own" on public.ingest_tokens;
create policy "tokens_own" on public.ingest_tokens for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.ingest_tokens from anon;
grant select, insert, delete on public.ingest_tokens to authenticated;

-- 아이폰 단축어가 호출하는 함수 (키가 맞을 때만 그 사용자의 건강 데이터를 기록)
create or replace function public.ingest_health(
  p_token text,
  p_date date default null,
  p_weight numeric default null,
  p_weight_date date default null,
  p_steps numeric default null,
  p_active numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  d date := coalesce(p_date, (now() at time zone 'Asia/Seoul')::date);
  wd date := coalesce(p_weight_date, coalesce(p_date, (now() at time zone 'Asia/Seoul')::date));
  act numeric := p_active;
begin
  select user_id into uid from ingest_tokens where token = p_token;
  if uid is null then raise exception 'invalid token'; end if;
  if act is not null and act > 15000 then act := act / 4184; end if; -- 줄(J) 단위면 kcal로 변환
  if p_steps is not null or act is not null then
    insert into docs (user_id, key, data, updated_at)
    values (uid, 'health:' || d, jsonb_strip_nulls(jsonb_build_object('steps', round(p_steps), 'active', round(act), 'src', 'shortcut')), now())
    on conflict (user_id, key) do update set data = docs.data || excluded.data, updated_at = now();
  end if;
  if p_weight is not null then
    insert into docs (user_id, key, data, updated_at)
    values (uid, 'health:' || wd, jsonb_build_object('weight', round(p_weight, 2), 'src', 'shortcut'), now())
    on conflict (user_id, key) do update set data = docs.data || excluded.data, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'date', d, 'weight_date', case when p_weight is null then null else wd end);
end $$;
revoke all on function public.ingest_health(text, date, numeric, date, numeric, numeric) from public;
grant execute on function public.ingest_health(text, date, numeric, date, numeric, numeric) to anon, authenticated;
