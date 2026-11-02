-- 0062: attendance reports. Admin a1, Head office c1, coordinator d1 (Priya), parent e1 (Parent A) from foundation.test.sql.
-- A class of its own: Mon to Fri, 09:00 to 13:00. The week of Monday 2 March 2026, with Wednesday a holiday; "today" is
-- Monday 9 March.
select set_config('app.now', '2026-03-09 10:00:00+05:30', false);
insert into public.classes (id, name, sort) values ('00000000-0000-0000-0000-0000000062c1', 'Report class', 99);
insert into public.programmes (id, name, class_id, weekdays, starts, ends, flexible) values
  ('00000000-0000-0000-0000-0000000062b1', 'Report programme', '00000000-0000-0000-0000-0000000062c1', '{1,2,3,4,5}', '09:00', '13:00', true);
insert into public.children (id, full_name, date_of_birth, class_id, programme_id, created_at) values
  ('00000000-0000-0000-0000-0000000062a1', 'Riya One', '2022-01-01', '00000000-0000-0000-0000-0000000062c1', '00000000-0000-0000-0000-0000000062b1', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000062a2', 'Rohan Two', '2022-01-01', '00000000-0000-0000-0000-0000000062c1', '00000000-0000-0000-0000-0000000062b1', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000062a3', 'Rahul Three', '2022-01-01', '00000000-0000-0000-0000-0000000062c1', '00000000-0000-0000-0000-0000000062b1', '2026-03-05');
insert into public.holidays (day, name) values ('2026-03-04', 'Report holiday') on conflict (day) do nothing;
-- Riya on Monday: checked in at the gate by Priya at 09:05, handed to her mother at 13:20. Absent on Tuesday.
insert into public.trips (child_id, direction, day, status, arrive_at, created_by, traveller_name, closed_by, closed_at, handed_to) values
  ('00000000-0000-0000-0000-0000000062a1', 'dropoff', '2026-03-02', 'checked_in', '2026-03-02 09:05+05:30', '00000000-0000-0000-0000-0000000000d1', 'At the gate', '00000000-0000-0000-0000-0000000000d1', '2026-03-02 09:05+05:30', null),
  ('00000000-0000-0000-0000-0000000062a1', 'pickup', '2026-03-02', 'handed_over', '2026-03-02 13:20+05:30', '00000000-0000-0000-0000-0000000000e1', 'Parent A', '00000000-0000-0000-0000-0000000000d1', '2026-03-02 13:20+05:30', '00000000-0000-0000-0000-0000000000e1');
insert into public.attendance (child_id, day, status, checked_in_at, checked_out_at, note) values
  ('00000000-0000-0000-0000-0000000062a1', '2026-03-02', 'present', '2026-03-02 09:05+05:30', '2026-03-02 13:20+05:30', null),
  ('00000000-0000-0000-0000-0000000062a1', '2026-03-03', 'absent', null, null, 'Fever'),
  -- Rohan on Monday: an older record with a drop-off time and no gate action, and no pickup.
  ('00000000-0000-0000-0000-0000000062a2', '2026-03-02', 'present', '2026-03-02 09:40+05:30', null, null);

create function pg_temp.as_who(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p)::text, false)
$$;
create function pg_temp.rows(r json) returns setof json language sql as $$ select json_array_elements(r -> 'rows') $$;

set role authenticated;
select pg_temp.as_who('00000000-0000-0000-0000-0000000000a1');
do $$ declare r json; riya json; rohan json; begin
  r := public.attendance_report('2026-03-02', '2026-03-31', '00000000-0000-0000-0000-0000000062c1');
  assert r ->> 'cutoff' = '2026-03-09', 'nothing after today: ' || (r ->> 'cutoff');
  -- Riya and Rohan Mon, Tue, Thu, Fri, and Mon 9; Rahul from Thursday 5 (enrolled then). No holiday, no weekend.
  assert (select count(*) from pg_temp.rows(r)) = 5 + 5 + 3, 'expected days only: ' || (select count(*) from pg_temp.rows(r));
  assert not exists (select 1 from pg_temp.rows(r) x where x ->> 'day' in ('2026-03-04', '2026-03-07', '2026-03-08')), 'no holiday or weekend';
  assert not exists (select 1 from pg_temp.rows(r) x where x ->> 'child' = 'Rahul Three' and x ->> 'day' < '2026-03-05'), 'not before enrolment';
  assert exists (select 1 from json_array_elements(r -> 'holidays') h where h ->> 'name' = 'Report holiday'), 'holidays listed';
  select x into riya from pg_temp.rows(r) x where x ->> 'child' = 'Riya One' and x ->> 'day' = '2026-03-02';
  assert riya ->> 'dropoff_source' = 'gate' and riya ->> 'dropoff_by' = 'Priya', 'verified drop-off: ' || riya::text;
  assert riya ->> 'pickup_source' = 'gate' and riya ->> 'pickup_to' = 'Parent A' and riya ->> 'pickup_by' = 'Priya', 'verified pickup';
  assert riya ->> 'sched_in' = '09:00' and riya ->> 'sched_out' = '13:00' and (riya ->> 'expected')::boolean, 'scheduled times';
  assert riya ->> 'pickup_announced_at' is null and riya ->> 'dropoff_announced_at' is null, 'a gate action is not an announcement';
  select x into rohan from pg_temp.rows(r) x where x ->> 'child' = 'Rohan Two' and x ->> 'day' = '2026-03-02';
  assert rohan ->> 'dropoff_source' = 'record' and rohan ->> 'pickup_at' is null, 'an older record is not a gate action: ' || rohan::text;
  assert (select x ->> 'marked' from pg_temp.rows(r) x where x ->> 'child' = 'Riya One' and x ->> 'day' = '2026-03-03') = 'absent', 'absence';
  assert (select count(*) from pg_temp.rows(public.attendance_report('2026-03-02', '2026-03-08', null, null, '00000000-0000-0000-0000-0000000062a1'))) = 4, 'one child';
  assert (select count(*) from pg_temp.rows(public.attendance_report('2026-03-02', '2026-03-08', null, '00000000-0000-0000-0000-0000000062b1'))) = 10, 'one programme';
  begin perform public.attendance_report('2026-03-09', '2026-03-02'); raise exception 'FAIL: backwards range';
  exception when sqlstate '22023' then null; end;
  begin perform public.attendance_report('2025-01-01', '2026-03-02'); raise exception 'FAIL: over a year';
  exception when sqlstate '22023' then null; end;
end $$;

-- Head office reads too, and since 0064 the gate roles (zz_..._gate_roles_read_attendance.test.sql); parents don't.
select pg_temp.as_who('00000000-0000-0000-0000-0000000000c1');
do $$ begin assert json_typeof(public.attendance_report('2026-03-02', '2026-03-08') -> 'rows') = 'array', 'Head office reads'; end $$;
select pg_temp.as_who('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  perform 1 from public.attendance_corrections;
  assert (select count(*) from public.attendance_corrections) = 0, 'a coordinator sees no corrections';
end $$;
-- Parent A (e1) is also a coordinator in these fixtures; a parent-only refusal is tested with 0064.

-- Corrections: admin only, with a reason, all or nothing, each field kept, a repeat changes nothing.
select pg_temp.as_who('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-02T13:05:00+05:30"}', 'Pickup not tapped at the gate', gen_random_uuid());
  raise exception 'FAIL: Head office corrected';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_who('00000000-0000-0000-0000-0000000000a1');
do $$ declare req uuid := gen_random_uuid(); r json; begin
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-02T13:05:00+05:30"}', ' ', req);
    raise exception 'FAIL: no reason'; exception when sqlstate 'P0001' then assert sqlerrm like 'reason_required%', sqlerrm; end;
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-02T08:05:00+05:30"}', 'Typo fix', gen_random_uuid());
    raise exception 'FAIL: pickup before drop-off'; exception when sqlstate 'P0001' then assert sqlerrm like 'pickup_before_dropoff%', sqlerrm; end;
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"status": "absent"}', 'Typo fix', gen_random_uuid());
    raise exception 'FAIL: absent with times'; exception when sqlstate 'P0001' then assert sqlerrm like 'times_need_present%', sqlerrm; end;
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-10', '{"status": "present"}', 'Typo fix', gen_random_uuid());
    raise exception 'FAIL: future day'; exception when sqlstate 'P0001' then assert sqlerrm like 'future_day%', sqlerrm; end;
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-03T13:05:00+05:30"}', 'Typo fix', gen_random_uuid());
    raise exception 'FAIL: wrong day'; exception when sqlstate 'P0001' then assert sqlerrm like 'wrong_day%', sqlerrm; end;
  begin perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"status": "sleeping"}', 'Typo fix', gen_random_uuid());
    raise exception 'FAIL: bad status'; exception when sqlstate '22023' then null; end;

  perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-02T13:05:00+05:30", "note": "Collected by father"}', 'Pickup not tapped at the gate', req);
  perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"pickup_at": "2026-03-02T13:05:00+05:30", "note": "Collected by father"}', 'Pickup not tapped at the gate', req);
  assert (select count(*) from public.attendance_corrections where request_id = req) = 2, 'pickup and note, once: ' || (select count(*) from public.attendance_corrections where request_id = req);
  assert (select old_value is null and new_value is not null and corrected_by = '00000000-0000-0000-0000-0000000000a1' from public.attendance_corrections where request_id = req and field = 'pickup'), 'old and new kept';
  r := (select x from pg_temp.rows(public.attendance_report('2026-03-02', '2026-03-02', null, null, '00000000-0000-0000-0000-0000000062a2')) x);
  assert r ->> 'pickup_source' = 'corrected' and json_array_length(r -> 'corrections') = 2, 'shown as corrected: ' || r::text;
  -- Nothing different: no correction recorded.
  perform public.correct_attendance('00000000-0000-0000-0000-0000000062a2', '2026-03-02', '{"note": "Collected by father"}', 'Same again', gen_random_uuid());
  assert (select count(*) from public.attendance_corrections where child_id = '00000000-0000-0000-0000-0000000062a2') = 2, 'an unchanged value is not a correction';
  -- A day with no record yet: Rahul on Thursday was present, dropped at 09:12.
  perform public.correct_attendance('00000000-0000-0000-0000-0000000062a3', '2026-03-05', '{"dropoff_at": "2026-03-05T09:12:00+05:30"}', 'Gate tablet was offline', gen_random_uuid());
  assert (select status = 'present' from public.attendance where child_id = '00000000-0000-0000-0000-0000000062a3' and day = '2026-03-05'), 'a time makes the day present';

  r := public.log_report_export('executive', 'pdf', '{"from": "2026-03-02"}');
  assert r ->> 'report_id' like 'JSG-20260309-%' or r ->> 'report_id' like 'JSG-%', 'report id: ' || r::text;
  begin perform public.log_report_export('executive', 'exe', '{}'); raise exception 'FAIL: unknown format';
  exception when sqlstate '22023' then null; end;
end $$;
-- Older than the 30 days trips are kept: the times stay, the gate details are gone ('expired', not 'record').
select set_config('app.now', '2026-04-09 10:00:00+05:30', false);
do $$ declare r json; begin
  r := (select x from pg_temp.rows(public.attendance_report('2026-03-02', '2026-03-02', null, null, '00000000-0000-0000-0000-0000000062a1')) x);
  assert r ->> 'dropoff_source' = 'expired' or r ->> 'dropoff_source' = 'gate', 'old day: ' || r::text;
  assert (public.attendance_report('2026-03-02', '2026-03-02') ->> 'verification_from') = '2026-03-10', 'kept from 30 days back';
end $$;
reset role;
-- The purge has run: the trips are gone, the attendance stays.
delete from public.trips where child_id = '00000000-0000-0000-0000-0000000062a1' and day = '2026-03-02';
set role authenticated;
do $$ declare r json; begin
  r := (select x from pg_temp.rows(public.attendance_report('2026-03-02', '2026-03-02', null, null, '00000000-0000-0000-0000-0000000062a1')) x);
  assert r ->> 'dropoff_source' = 'expired' and r ->> 'pickup_source' = 'expired' and r ->> 'dropoff_at' is not null, 'expired, times kept: ' || r::text;
end $$;
-- A child who left: Rohan, deactivated on Thursday 5 March, is due Monday and Tuesday only. Riya also does a club on
-- Saturdays, so Saturday 7 March is due for her, until 15:00. A deactivation older than the audit log (a year) is gone:
-- such a child is due on no day at all.
reset role;
insert into public.programmes (id, name, class_id, weekdays, starts, ends, flexible) values
  ('00000000-0000-0000-0000-0000000062b2', 'Report club', '00000000-0000-0000-0000-0000000062c1', '{6}', '12:00', '15:00', true);
insert into public.child_programmes values ('00000000-0000-0000-0000-0000000062a1', '00000000-0000-0000-0000-0000000062b2');
update public.children set active = false where id in ('00000000-0000-0000-0000-0000000062a2', '00000000-0000-0000-0000-0000000062a3');
update public.audit_log set at = '2026-03-05 08:00+05:30' where table_name = 'children' and new_row ->> 'id' = '00000000-0000-0000-0000-0000000062a2';
-- A later edit of a child who has already left (a data fix, a migration) doesn't move the day they left.
update public.children set full_name = 'Rohan Two' where id = '00000000-0000-0000-0000-0000000062a2';
delete from public.audit_log where table_name = 'children' and new_row ->> 'id' = '00000000-0000-0000-0000-0000000062a3';
set role authenticated;
do $$ declare r json; begin
  r := public.attendance_report('2026-03-02', '2026-03-08', '00000000-0000-0000-0000-0000000062c1');
  assert (select array_agg(x ->> 'day' order by x ->> 'day') from pg_temp.rows(r) x where x ->> 'child' = 'Rohan Two' and (x ->> 'expected')::boolean)
    = '{2026-03-02,2026-03-03}', 'due until he left: ' || r::text;
  assert (select x ->> 'sched_out' from pg_temp.rows(r) x where x ->> 'child' = 'Riya One' and x ->> 'day' = '2026-03-07') = '15:00', 'club Saturday due';
  assert not exists (select 1 from pg_temp.rows(r) x where x ->> 'child' = 'Rahul Three' and (x ->> 'expected')::boolean), 'left long ago: never due';
  assert exists (select 1 from pg_temp.rows(r) x where x ->> 'child' = 'Rahul Three' and x ->> 'day' = '2026-03-05'), 'but his recorded day stays';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.audit_log where action = 'export' and table_name = 'attendance_report' and new_row ->> 'format' = 'pdf'), 'the export is logged';
  assert exists (select 1 from public.audit_log where table_name = 'attendance' and actor = '00000000-0000-0000-0000-0000000000a1'), 'the corrected record is audited too';
end $$;
select set_config('app.now', '', false);
