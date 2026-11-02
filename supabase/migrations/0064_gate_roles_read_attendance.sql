-- 0064: Center Leaders and Center Coordinators read attendance (owner, 2026-11-02).
--   Every gate role sees every student's attendance, grouped by class on the page, and can download the reports.
--   attendance_report and log_report_export are the same as in 0062 except who may call them. Corrections stay with the
--   admin (correct_attendance is unchanged), and parents still can't read reports.
-- Rollback: re-run the two functions from 0062.

create or replace function public.attendance_report(p_from date, p_to date, p_class uuid default null, p_programme uuid default null, p_child uuid default null)
returns json
language plpgsql stable security definer set search_path = '' set jit = off as $$
declare
  upto date := least(p_to, app.today());
  -- Trips are deleted after 30 days (0021, as the consent notice promises), so who checked in or handed over a child on
  -- an earlier day is no longer known: its times are 'expired', neither verified nor suspect.
  kept date := app.today() - 30;
begin
  if app.me() is null or not app.has_role('admin', 'core', 'leader', 'coordinator') then
    raise exception 'Only school staff can see attendance reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'bad_range: Choose a start date on or before the end date.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'bad_range: Choose a period of a year or less.' using errcode = '22023';
  end if;
  return json_build_object(
    'generated_at', now(),
    'from', p_from, 'to', p_to, 'cutoff', upto, 'today', app.today(), 'timezone', 'Asia/Kolkata', 'verification_from', kept,
    'holidays', (select coalesce(json_agg(json_build_object('day', h.day, 'name', h.name) order by h.day), '[]'::json)
      from public.holidays h where h.day between p_from and upto),
    'rows', (select coalesce(json_agg(r order by r.day, r.child), '[]'::json) from (
      -- Per child and per programme work is done once here, not once per child and day: a year is 50,000 child-days.
      with kids as materialized (
        select c.id, c.full_name, c.class_id, c.active, cl.name as class, pm.name as programme,
          (c.created_at at time zone 'Asia/Kolkata')::date as since,
          array(select cp.programme_id from public.child_programmes cp where cp.child_id = c.id) || c.programme_id as progs
        from public.children c
        join public.classes cl on cl.id = c.class_id
        join public.programmes pm on pm.id = c.programme_id
        where (p_child is null or c.id = p_child) and (p_class is null or c.class_id = p_class)
          and (p_programme is null or c.programme_id = p_programme
               or exists (select 1 from public.child_programmes cp where cp.child_id = c.id and cp.programme_id = p_programme))
      ),
      -- When each deactivated child left: their last change from active to not, in one pass over the audit log (later
      -- edits of a child who has left don't move it). The log is kept a year: a child with no such entry left before
      -- then and is due on no day.
      gone as materialized (
        select l.new_row ->> 'id' as id, max(l.at at time zone 'Asia/Kolkata')::date as day from public.audit_log l
        where l.table_name = 'children' and l.new_row ->> 'active' = 'false' and l.old_row ->> 'active' = 'true'
          and l.new_row ->> 'id' in (select k.id::text from kids k where not k.active)
        group by 1
      ),
      -- The days each of their programmes runs, with its times.
      runs as materialized (
        select p.id, g.dd::date as day, p.starts, p.ends from public.programmes p
        cross join generate_series(p_from, upto, interval '1 day') g(dd)
        where p.id in (select unnest(k.progs) from kids k) and app.runs_on(p.id, g.dd::date)
      ),
      -- Each child's due days: one of their programmes runs, from the earliest start to the latest end.
      due as materialized (
        select k.id, r.day, min(r.starts) as starts, max(r.ends) as ends from kids k join runs r on r.id = any (k.progs) group by k.id, r.day
      )
      select c.id as child_id, c.full_name as child, c.class, c.class_id, c.programme, d.day,
        x.expected,
        to_char(coalesce(dti.at, cs.dropoff, x.starts), 'HH24:MI') as sched_in,
        to_char(coalesce(dto.at, cs.pickup, x.ends), 'HH24:MI') as sched_out,
        a.status as marked, a.note, a.checked_in_at as dropoff_at, a.checked_out_at as pickup_at,
        -- Where each time comes from: the gate's own action, an admin's correction, or an older record.
        case when a.checked_in_at is null then null
          when exists (select 1 from public.attendance_corrections k where k.child_id = c.id and k.day = d.day and k.field = 'dropoff') then 'corrected'
          when din.closed_at is not null then 'gate' when d.day < kept then 'expired' else 'record' end as dropoff_source,
        case when a.checked_out_at is null then null
          when exists (select 1 from public.attendance_corrections k where k.child_id = c.id and k.day = d.day and k.field = 'pickup') then 'corrected'
          when dout.closed_at is not null then 'gate' when d.day < kept then 'expired' else 'record' end as pickup_source,
        (select p.full_name from public.profiles p where p.id = din.closed_by) as dropoff_by,
        (select p.full_name from public.profiles p where p.id = dout.closed_by) as pickup_by,
        coalesce((select p.full_name from public.profiles p where p.id = dout.handed_to), dout.handed_to_name) as pickup_to,
        -- Announcements: a parent's request, not proof. A walk-in at the gate has none.
        case when din.created_at < din.closed_at - interval '5 seconds' then din.created_at end as dropoff_announced_at,
        pann.created_at as pickup_announced_at, pann.arrived_at as pickup_arrived_at, pann.ready_at,
        (select coalesce(json_agg(json_build_object('field', k.field, 'old', k.old_value, 'new', k.new_value, 'reason', k.reason,
            'by', (select p.full_name from public.profiles p where p.id = k.corrected_by), 'at', k.corrected_at) order by k.id), '[]'::json)
          from public.attendance_corrections k where k.child_id = c.id and k.day = d.day) as corrections
      from kids c
      cross join generate_series(p_from, upto, interval '1 day') g(dd)
      cross join lateral (select g.dd::date as day) d
      left join gone z on z.id = c.id::text
      left join due w on w.id = c.id and w.day = d.day
      -- Expected: enrolled by then, not yet deactivated, and one of their programmes runs that day.
      cross join lateral (select (d.day >= c.since and (c.active or d.day < coalesce(z.day, '-infinity')) and w.id is not null) as expected,
        w.starts, w.ends) x
      left join public.attendance a on a.child_id = c.id and a.day = d.day
      left join public.child_schedules cs on cs.child_id = c.id and cs.weekday = extract(isodow from d.day)
      left join public.day_times dti on dti.child_id = c.id and dti.day = d.day and dti.direction = 'dropoff'
      left join public.day_times dto on dto.child_id = c.id and dto.day = d.day and dto.direction = 'pickup'
      left join lateral (select t.* from public.trips t where t.child_id = c.id and t.day = d.day and t.status = 'checked_in' order by t.closed_at limit 1) din on true
      left join lateral (select t.* from public.trips t where t.child_id = c.id and t.day = d.day and t.status = 'handed_over' order by t.closed_at desc limit 1) dout on true
      left join lateral (select t.* from public.trips t where t.child_id = c.id and t.day = d.day and t.direction = 'pickup' and t.status <> 'cancelled'
        and t.created_at < coalesce(t.closed_at, 'infinity') - interval '5 seconds' order by t.created_at desc limit 1) pann on true
      where x.expected or a.child_id is not null or din.id is not null or dout.id is not null
    ) r)
  );
end $$;

-- 3. Export log -----------------------------------------------------------------------------------------------------------
-- Logged before any file is made. Returns the Report ID and the data cutoff printed on it.
create or replace function public.log_report_export(p_report text, p_format text, p_filters jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := app.me();
  id_ bigint;
begin
  if me is null or not app.has_role('admin', 'core', 'leader', 'coordinator') then
    raise exception 'Only school staff can download attendance reports.' using errcode = '42501';
  end if;
  if p_report not in ('executive', 'register', 'detailed') or p_format not in ('pdf', 'xlsx', 'docx', 'csv') then
    raise exception 'Unknown report or format.' using errcode = '22023';
  end if;
  perform app.throttle('export:' || me, 30, interval '10 minutes');
  insert into public.audit_log (actor, action, table_name, new_row)
  values (auth.uid(), 'export', 'attendance_report', jsonb_build_object('report', p_report, 'format', p_format, 'filters', coalesce(p_filters, '{}'::jsonb), 'profile', me))
  returning id into id_;
  return json_build_object('report_id', 'JSG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD') || '-' || lpad(id_::text, 6, '0'), 'generated_at', now());
end $$;
