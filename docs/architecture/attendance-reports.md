# Attendance & Reports (PRD D63, D65)

Admin, Head office (core), Center Leaders and Center Coordinators (0064); only the admin corrects. Every one of them
sees every student. One dataset feeds the dashboard, the register and every download, so they never disagree.

The page opens on **Classes**: one closed section per class with its student count and the period's present and absent
figures; tapping a class opens its students. For one day each student shows check-in, check-out (or "Not checked
out" when dropped off and not collected) and status; for a longer period, days present, late, absent and not
recorded. There is no class picker. Gate roles reach the page from the Attendance tab at `/coordinator/reports`.

## Students by programme

A student's programme is their saved main programme (`children.programme_id`, which gives the class); other
programmes they attend (`child_programmes`) show beside it. Each student is in exactly one programme group, so group
counts add up to the whole school, and the same rule feeds the screen, the PDF and Excel
(`src/features/admin/programmeGroups.ts`). Groups follow the school's order (Playgroup to Sr KG, then the standalone
programmes). A child whose programme isn't active is listed under "Programme not assigned", never under a guessed one.

- **Admin → People → Children:** chips for All students and each programme with students (with counts), sections per
  programme, names A–Z or Z–A, search by child, parent, phone or any programme the child attends.
- **Attendance & Reports → Students:** By class or By programme, each section with the period's figures per student,
  and a search by student, class or programme name. The register's search also matches class and programme.
- The report's Programme filter (0062) includes children who attend that programme as an extra one.

## Data: `attendance_report` (0062)

One row per child and day in the period, up to today (India time), for children who were expected or have anything
recorded. Admin or core only (42501 otherwise); at most 366 days.

- **Expected:** enrolled by then, not deactivated yet, and one of the child's programmes runs that day (weekdays, term,
  holidays, Saturday rule). The day a child left is their last active → inactive change in the audit log; the log is
  kept a year, so a child with no such entry left earlier and is due on no day.
- **Times and sources:** drop-off and pickup times come from the attendance record. Each has a source: `gate` (the
  coordinator's Check in or Hand over), `corrected` (an admin correction with a reason), `record` (an older record
  with neither) or `expired` (older than the 30 days trips are kept: the time stands, who did it is gone).
- **Announcements** (on my way, arrived, ready) are shown apart and never count as attendance.
- **Performance:** per-child and per-programme work is done once in CTEs (children, leaving dates in one pass over the
  audit log, programme run days, due days hash-joined), and the function runs with `jit = off` (the planner's estimate
  made JIT compilation take 1.8 s of a 1.9 s query). Measured on Postgres 16 with 150 children, 37,000 attendance rows,
  70,000 trips and 200,000 audit rows: a month in 139 ms (was 11.3 s), a year in 1.3 s (was 116 s). Supabase's
  statement timeout for signed-in users is about 8 s.

## Engine (`src/features/reports/engine.ts`)

Statuses Present, Late (verified drop-off more than 10 minutes after the scheduled time), Absent, Not recorded,
Expected (today, not yet due), Not due. Record Complete, On campus (today), Incomplete (present without a verified
drop-off or pickup), Over 30 days (`expired` times: neither verified nor incomplete, never late), none. KPIs:
attendance rate = (P + L) / (P + L + A); coverage = (P + L + A) / (P + L + A + Not recorded); incomplete = not
recorded + missing verification. Insights only state what the figures show, and always say when part of the period
is older than 30 days.

## Corrections (0062)

`correct_attendance`: admin only, a reason of 3–300 characters, all or nothing, each changed field kept with its old
and new value, who and when; idempotent by request id (the app makes one id per exact correction, so an edited retry
is never taken for an earlier one). The admin becomes the record's `reported_by`, so no absence alert goes out in a
parent's name.

## Downloads

Made in the browser and never stored: executive one-page A4 landscape PDF, detailed numbered PDF, Excel, Word, CSV.

The Excel workbook (`exports/xlsx.ts`) is titled JUMPSTART GO — ATTENDANCE REPORT on every sheet, with the centre,
period and generation time: **Executive Summary** (report details, enrolment by programme, attendance, pickup and
drop-off activity, observations), **Detailed Attendance** (one row per child-day, only when the register is included),
**Programme-wise Report** (with an All programmes total row outside the filter), **Student-wise Summary** and
**Notes**. Each table has a frozen, filtered header repeated on printed pages, A4 fit-to-width, real dates and times,
wrapped long names and banded rows. Totals are values, not formulas. Names are text cells, so a name starting with "="
never runs as a formula. Tested at 1,000 students for a month (20,000 rows).
The detailed PDF compares programmes after classes, unless it would repeat the class table (one programme per class).
The detailed PDF (A4 landscape) opens with a summary (students in scope, present, confirmed absent, late arrivals,
completed check-outs, incomplete records; no figures at all when nothing matches), then the classes compared, then
one section per class: its rows sorted by student and date, the column header repeated on each page it continues to,
names wrapped to two lines, rows never split across pages, times on the 12-hour clock, "Page n of N" on every page.
A one-day report leaves out the Date column.
The file maker and fonts load first, then `log_report_export` records the download (who, report, format, filters)
and returns the Report ID printed on the file; a build replaced by a deploy since the page opened says "reload"
before anything is logged. The export libraries and the PDF library's optional chunks are lazy and kept out of the
service worker's precache. The PDF preview needs `frame-src blob:` (public/_headers); it is hidden where the browser
shows no PDF inside a page (Chrome on Android), and the Android app's web view can't save files, so downloads there
say to use a browser.

## Known limits

- Expected days and scheduled times use the child's **current** programmes, terms and regular times; a change applies
  to earlier days too (said in the Excel definitions). Effective-dated history would fix it.
- Gate details are kept 30 days (consent notice); older days show recorded times only.
