-- ingest_health v2: 단축어가 보내는 값이 빈 문자열("")이거나 "77.5 kg", "2026. 11. 10." 같은 형식이어도 받아들이도록 변경
drop function if exists public.ingest_health(text, date, numeric, date, numeric, numeric);

create or replace function public.mg_num(x text) returns numeric
language sql immutable as $$
  select nullif(regexp_replace(replace(coalesce(x, ''), ',', ''), '[^0-9.\-]', '', 'g'), '')::numeric
$$;

create or replace function public.mg_date(x text) returns date
language plpgsql immutable as $$
declare m text[];
begin
  if x is null or btrim(x) = '' then return null; end if;
  m := regexp_match(x, '(\d{4})\D+(\d{1,2})\D+(\d{1,2})');
  if m is null then return null; end if;
  return make_date(m[1]::int, m[2]::int, m[3]::int);
exception when others then return null;
end $$;

create or replace function public.ingest_health(
  p_token text,
  p_date text default null,
  p_weight text default null,
  p_weight_date text default null,
  p_steps text default null,
  p_active text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  today date := (now() at time zone 'Asia/Seoul')::date;
  d date := coalesce(mg_date(p_date), today);
  wd date := coalesce(mg_date(p_weight_date), d);
  w numeric := mg_num(p_weight);
  st numeric := mg_num(p_steps);
  act numeric := mg_num(p_active);
begin
  select user_id into uid from ingest_tokens where token = btrim(p_token);
  if uid is null then raise exception 'invalid token'; end if;
  if act is not null and act > 15000 then act := act / 4184; end if; -- 줄(J) 단위면 kcal로 변환
  if w is not null and (w < 30 or w > 250) then w := null; end if;    -- 단위 오류 방지
  if st is not null or act is not null then
    insert into docs (user_id, key, data, updated_at)
    values (uid, 'health:' || d, jsonb_strip_nulls(jsonb_build_object('steps', round(st), 'active', round(act), 'src', 'shortcut')), now())
    on conflict (user_id, key) do update set data = docs.data || excluded.data, updated_at = now();
  end if;
  if w is not null then
    insert into docs (user_id, key, data, updated_at)
    values (uid, 'health:' || wd, jsonb_build_object('weight', round(w, 2), 'src', 'shortcut'), now())
    on conflict (user_id, key) do update set data = docs.data || excluded.data, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'date', d, 'weight', w, 'weight_date', case when w is null then null else wd end, 'steps', round(st), 'active', round(act));
end $$;

revoke all on function public.ingest_health(text, text, text, text, text, text) from public;
grant execute on function public.ingest_health(text, text, text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
select mg_num('77.5 kg') as w, mg_num('17,449') as steps, mg_num('') as empty, mg_date('2026. 11. 10.') as d1, mg_date('2026-11-09') as d2;
