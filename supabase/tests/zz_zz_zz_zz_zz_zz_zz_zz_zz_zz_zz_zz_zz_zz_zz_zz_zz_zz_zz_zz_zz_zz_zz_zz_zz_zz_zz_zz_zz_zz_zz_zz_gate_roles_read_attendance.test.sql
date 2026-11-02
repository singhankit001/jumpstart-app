-- 0064: Center Coordinators and Center Leaders read every student's attendance and download reports; they can't correct.
-- Admin a1 and coordinator d1 (Priya) from foundation.test.sql; Riya (62a1) from the 0062 test. "Today" is Monday 9 March 2026.
select set_config('app.now', '2026-03-09 10:00:00+05:30', false);
insert into public.profiles (id, full_name, email, active, phone) values
  ('00000000-0000-0000-0000-0000000064d1', 'Lata Leader', 'lata.0064@example.test', true, '+919000006401'),
  ('00000000-0000-0000-0000-0000000064d3', 'Front Desk', 'desk.0064@example.test', true, '+919000006403'),
  ('00000000-0000-0000-0000-0000000064e1', 'Only Parent', 'parent.0064@example.test', true, '+919000006404');
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000064d1', 'lata.0064@example.test', '{"provisioned":"school"}'),
  ('00000000-0000-0000-0000-0000000064d3', 'desk.0064@example.test', '{"provisioned":"school"}'),
  ('00000000-0000-0000-0000-0000000064e1', 'parent.0064@example.test', '{"provisioned":"school"}');
-- A parent with no staff role, of a child in the report.
insert into public.guardianships (child_id, guardian_id, relation) values ('00000000-0000-0000-0000-0000000062a1', '00000000-0000-0000-0000-0000000064e1', 'Mother');
-- Lata leads no class at all: she still sees every student.
insert into public.staff_roles values ('00000000-0000-0000-0000-0000000064d1', 'leader'), ('00000000-0000-0000-0000-0000000064d3', 'pro');

create function pg_temp.as_who(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
create function pg_temp.kids(r json) returns bigint language sql as $$ select count(distinct x ->> 'child_id') from json_array_elements(r -> 'rows') x $$;
set role authenticated;

select pg_temp.as_who('00000000-0000-0000-0000-0000000000a1');
create temp table everyone as select pg_temp.kids(public.attendance_report('2026-03-02', '2026-03-06')) as n;

select pg_temp.as_who('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  assert pg_temp.kids(public.attendance_report('2026-03-02', '2026-03-06')) = (select n from everyone), 'a coordinator sees every student';
  assert (select n from everyone) > 0, 'there are students to see';
  assert public.log_report_export('register', 'pdf', '{}') ->> 'report_id' like 'JSG-%', 'a coordinator download is logged';
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a1', '2026-03-02', '{"status":"absent"}', 'Gate trying', gen_random_uuid());
    raise exception 'FAIL: a coordinator corrected attendance';
  exception when insufficient_privilege then null; end;
end $$;

select pg_temp.as_who('00000000-0000-0000-0000-0000000064d1');
do $$ begin
  assert pg_temp.kids(public.attendance_report('2026-03-02', '2026-03-06')) = (select n from everyone), 'a leader with no classes still sees every student';
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a1', '2026-03-02', '{"status":"absent"}', 'Leader trying', gen_random_uuid());
    raise exception 'FAIL: a leader corrected attendance';
  exception when insufficient_privilege then null; end;
end $$;

-- The front desk and parents still can't.
select pg_temp.as_who('00000000-0000-0000-0000-0000000064d3');
do $$ begin
  perform public.attendance_report('2026-03-02', '2026-03-06'); raise exception 'FAIL: the front desk read the report';
exception when insufficient_privilege then null; end $$;
select pg_temp.as_who('00000000-0000-0000-0000-0000000064e1');
do $$ begin
  perform public.attendance_report('2026-03-02', '2026-03-06', null, null, '00000000-0000-0000-0000-0000000062a1'); raise exception 'FAIL: a parent read the report';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.log_report_export('register', 'pdf', '{}'); raise exception 'FAIL: a parent logged an export';
exception when insufficient_privilege then null; end $$;
reset role;
