# Önbüro Görevler — Project Brief & Codebase Analysis

- **Repo:** https://github.com/hgfom2/onburo-gorev (MIT license)
- **Analysed commit:** `3fca5cf` — merge of PR #4 `feature/multi-shift` (2026-11-27)
- **Scope of this analysis:** source code, SQL and config in the repo only. The app was not run, and the live Supabase / Vercel settings were not inspected, so anything marked *verify* depends on those.

---

## 1. What it is

A web app for a hotel front office (önbüro; the header reads "Grand Sapphire · Önbüro Görevler") to plan, assign and track daily work across three shifts. The whole UI is in Turkish and it is built for a small team (about 15 people).

- Managers create one-off and recurring tasks, assign them to people, and watch completion.
- Reception staff see their own work and tick it off.
- A daily job generates the day's tasks from recurring definitions.
- Special task types: checklists with per-person sub-items, and a cash handover (kasa devri) that requires a photo of the cash report.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14.2 (App Router), React 18, plain JavaScript (no TypeScript), one global CSS file, no UI library |
| Backend | 3 Next.js route handlers + Supabase (Postgres with Row Level Security, Auth, Realtime, Storage) |
| Hosting | Vercel (daily cron defined in `vercel.json`) |
| Email | Resend (optional morning reminder) |
| Tooling | None: no tests, linter, TypeScript config or CI. Only 4 runtime dependencies. |

## 3. Repository layout

```
onburo-gorev/
├── LICENSE, .gitignore
└── onburo/                      ← the Next.js app (Vercel Root Directory must be "onburo")
    ├── README.md                ← Turkish, only covers the v2 update (outdated)
    ├── package.json, next.config.js (empty), vercel.json
    ├── app/
    │   ├── layout.js, globals.css
    │   ├── page.js              ← 702 lines: login, all screens, all forms
    │   ├── checklist.js         ← sub-items list/editor, cash handover form
    │   └── api/
    │       ├── login/route.js   ← username + PIN → Supabase session
    │       ├── users/route.js   ← admin-only user management (service role)
    │       └── cron/route.js    ← daily task generation + email reminders
    ├── lib/
    │   ├── supabase.js          ← browser client (anon key)
    │   ├── util.js              ← time zone, recurrence (occursOn), deadlines (dueFor)
    │   └── image.js             ← browser-side JPEG compression for cash reports
    └── supabase/
        ├── schema.sql           ← full current schema (v1–v6 merged)
        └── migration_v2/v3/v5/v6.sql
```

## 4. Architecture

- **The browser talks directly to Supabase** with the public anon key. Security is enforced by RLS policies and triggers in the database, not by the Next.js layer.
- **Next.js server routes exist only for what needs the service-role key:** PIN login, user administration, the daily cron.
- **Login:** username becomes `<username>@onburo.local`; the password is `PIN + PIN_PEPPER`. `/api/login` signs in on the server and returns tokens; the client calls `setSession`. An email/password fallback ("first admin") is shown on the login page.
- **Live updates:** the client subscribes to `tasks`, `task_notes`, `task_items`, `cash_handovers`. Any change triggers a debounced (800 ms) reload of the current screens. It also reloads when the tab becomes visible and polls every 5 minutes as a fallback.
- **Time zone:** `Europe/Nicosia`, with deadlines written as `+03:00`.

## 5. Data model

| Table | Purpose |
|---|---|
| `profiles` | One row per auth user: `full_name`, `username`, `role` (admin / supervisor / receptionist), `active`, plus `email` and `notify_email` (readable by the server only) |
| `categories` | Operasyon, Misafir İlişkileri, İdari, Checklist, Yönetim (`mgr_only` = visible to managers only) |
| `templates` | Recurring task definitions: shift, recurrence (`daily`, `weekly` + weekdays, `monthly_first`, `monthly_last`), optional `due_time`, `kind` (`normal` / `cash_handover`) |
| `template_items` | Checklist sub-items of a recurring definition, each with its own assignee |
| `tasks` | Concrete tasks: `status` (open / done / cancelled), `due_date`, `due_at`, `template_id`, `kind`, cancel reason/by/at. Unique on `(template_id, due_date)` |
| `task_items` | Sub-items copied onto each generated task (a trigger does the copy), with a `done` flag |
| `task_notes` | Notes on a task |
| `task_presets` | Quick-fill forms for one-off tasks (shown as "Görev şablonları" in the UI) |
| `cash_handovers` | One row per cash handover task: giver, receiver, report photo path |
| Storage `kasa-raporlari` | Private bucket, JPEG only, 2 MB limit |

Database functions and triggers: `handle_new_user`, `my_role`, `cat_visible`, `guard_task_update`, `guard_item_update`, `copy_template_items`.

> Naming trap: in the UI "Görev şablonları" means `task_presets` (quick-fill), while the recurring definitions are `templates` ("Aktif tekrarlayan görevler").

## 6. Roles and permissions (as enforced by RLS and triggers)

| Action | Admin | Supervisor | Receptionist |
|---|:-:|:-:|:-:|
| See tasks, notes, items | all | all | all except category Yönetim |
| See Yönetim category | ✔ | ✔ | ✘ |
| Create tasks, recurring definitions, presets | ✔ | ✔ | ✘ |
| Edit task details, assign, delete tasks | ✔ | ✔ | ✘ (trigger blocks title, shift, assignee, due date, kind…) |
| Complete / cancel a task | ✔ | ✔ | only if assignee, item assignee, or cash giver/receiver |
| Reopen a cancelled task | ✔ | ✔ | ✘ |
| Add notes | ✔ | ✔ | only on own tasks |
| Tick a checklist item | ✔ | ✔ | only own items |
| Record a cash handover | ✔ | ✔ | only as giver or receiver |
| View cash report photos | ✔ | ✔ | ✔ (every active user) |
| Manage users | ✔ (via `/api/users`) | ✘ | ✘ |
| Edit categories | ✔ in DB, but there is no UI | ✘ | ✘ |

## 7. Screens

| Tab | Who | Content |
|---|---|---|
| Görevlerim | everyone | Own tasks (also tasks where only a sub-item is assigned), late / due-in-2-hours banner |
| Vardiya / Gün | everyone | Tasks by date and shift, with overdue open tasks, completion counter |
| Atanmamış | managers | Open tasks with no assignee |
| Personel raporu | managers | This week / last week per person: total, done, open, cancelled, late |
| Görev ekle | managers | New task form (one-off or recurring, multi-shift), presets, list of active recurring tasks |
| Kullanıcılar | admin | Create / edit users, PIN, role, reminder email, deactivate |

Task card: checkbox, assign, edit, notes, cancel (reason required), reopen, checklist items, cash handover info. New one-off tasks are highlighted in a "Yeni görevler" group at the top; the Checklist category is sorted to the bottom.

## 8. Business rules

- **Shifts:** A 08:00–16:00, B 16:00–00:00 (default deadline 23:59), C 00:01–08:00 **of the next calendar day**. The "27 Kasım gece vardiyası" runs 28 Kasım 00:01–08:00, so its tasks have `due_date` 27 and `due_at` 28 08:00 (`dueFor` in `lib/util.js`). The operational day runs 08:00 → next 08:00 (`opDayStr()`) and is the default date of "Vardiya / Gün". Default deadline is the shift end unless the definition sets `due_time`; for C it must be 08:00 or earlier.
- **Recurring tasks:** one definition per shift (selecting several shifts creates several definitions, each with its own assignee and sub-item assignees). If the task occurs today, today's task is inserted immediately.
- **One-off deadline:** an exact date and time, or a relative duration (hours / days from now).
- **Late** means open and `due_at` is in the past.
- **Cancel:** a reason of at least 3 characters is enforced by a DB constraint.
- **Cash handover:** cannot be marked done without a `cash_handovers` row (giver ≠ receiver, JPEG report). The browser compresses the photo to ≤ 1.8 MB.
- **Yönetim category:** hidden from receptionists; the form refuses to assign such tasks to receptionists.
- **Deactivating a user** sets `active=false` (RLS then denies everything) and bans the auth user.

## 9. Configuration

| Variable | Required | Used for |
|---|:-:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | Supabase endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | Browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | User admin and cron (server only) |
| `PIN_PEPPER` | ✔ | Appended to PINs; never change it after users exist or all PINs become invalid |
| `CRON_SECRET` | ✔ | Bearer token the cron endpoint checks |
| `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` | optional | Morning reminder emails |

Only `PIN_PEPPER` and the service-role key are mentioned in the current README.

**New install:** create a Supabase project → run `supabase/schema.sql` → add the first user under Authentication → promote it with `update profiles set role='admin' …` → set the env vars in Vercel (Root Directory `onburo`) → deploy → log in with the email fallback and give yourself a username and PIN.

**Zamanlama (Vercel Schedules, `onburo/vercel.json`):** her gün 07:00 Europe/Nicosia, `GET /api/cron` (CRON_SECRET gerekir). It generates today's tasks from active definitions and sends one email per user who has a reminder address.

## 10. Review findings

Severity is my judgement from the code. Items marked *verify* depend on settings outside the repo.

### Security and data integrity

| # | Sev. | Finding | Suggested fix |
|---|---|---|---|
| 1 | High (*verify*) | `handle_new_user()` creates a profile for **every** new auth user, and `profiles.active` defaults to `true` with role `receptionist`. The anon key is public, so if "Allow new users to sign up" is on in Supabase Auth (the default), a stranger could register and read tasks, notes, staff names and all cash report photos. | Turn off public sign-ups in Supabase. Also default new profiles to `active=false` (the users API already sets `active: true` when an admin creates someone) and update the bootstrap step in the README. |
| 2 | Medium | PINs are 4–6 digits, and `/api/login` has no attempt limiting or lockout of its own. It relies on Supabase's built-in auth rate limits. | Add per-username throttling or lockout, and allow longer PINs or passphrases. |
| 3 | Medium | `guard_task_update` does not protect `completed_at`, `cancelled_by`, `cancelled_at`, `cancel_reason`, `created_by`, `created_at`. An assignee can falsify these audit fields through the API. | Set them server-side in the trigger (`auth.uid()`, `now()`) or reject changes. |
| 4 | Medium | Cash report photos: any active user can read every file and upload to any path in the bucket. A giver or receiver can also be set without the other side confirming. | Scope storage policies to the related task and its participants plus managers, and consider receiver confirmation. |
| 5 | Low–Med | Management-only rule is enforced in the form only. The "Ata…" dropdown on a task card and the sub-item reassign dropdown list everyone, and the DB has no constraint. A Yönetim task assigned to a receptionist becomes invisible to them. | Add a DB check or trigger and filter the dropdowns. |
| 6 | Low | `/api/users` POST is not atomic (auth user created, then profile updated; a failure leaves an orphan). Some error messages hint at configuration details. | Roll back on failure; return generic messages. |
| 7 | Low | `next.config.js` is empty, so no security headers (CSP etc.). | Add headers. |

### Behaviour and product gaps

| # | Finding |
|---|---|
| 8 | **Shift C timing (fixed on branch `fix/gece-vardiyasi`, needs `migration_v7.sql`):** C tasks had their deadline on the shift's own date at 08:00, which is before the night shift actually starts. They now fall on the next morning. Still open: there is no catch-up if a cron run fails, so a missed day means no recurring tasks (unless created by hand). |
| 9 | **Checklist tasks:** the parent task does not complete automatically when all items are ticked, and the card shows no progress (e.g. 3/5). |
| 10 | **Staff report ignores sub-items:** it counts only `tasks.assignee`, so work assigned through checklist items does not appear in the weekly numbers. |
| 11 | **Hard delete:** managers can permanently delete a task, which removes it from reports. No audit log or soft delete exists. |
| 12 | **Reminders** are email only (Resend) plus an in-app banner; there is no push notification. |
| 13 | **Realtime:** every change reloads each client's lists. Fine for ~15 users; revisit if the team grows. |

### Maintainability

- `page.js` is a 702-line monolith holding every screen and form.
- Recurrence and due-time logic is duplicated: the client inserts today's task itself when saving a recurring definition, and the cron does the same.
- `+03:00` is hard-coded in several places.
- No tests, even for `occursOn` and `dueFor`, which are the riskiest pure logic.
- Docs and SQL are drifting: the README only covers v2; `schema.sql` is headed "v1 + v2 + v3" but contains v6; there is no `migration_v4` file (realtime lives in `schema.sql`); migrations are not idempotent and not in `supabase/migrations`.

## 11. Suggested roadmap

**Phase 0 — Harden (small, do first):** findings 1–5, plus the full env-var list in the README.

**Phase 1 — Reliability:** cron catch-up after a failed run (8), soft delete and audit log (3, 11), a single clean README, ordered migrations, unit tests for `lib/util.js`.

**Phase 2 — Product:** checklist progress and auto-complete (9), per-item numbers in the report and CSV/Excel export (10), receiver confirmation for cash handover (4), reminders beyond email (12), a UI for categories.

**Phase 3 — Maintainability:** split `page.js` into components, move shared task-generation logic to one place, move to TypeScript, add ESLint and CI, add a few end-to-end tests of the main flows.

## 12. Questions to settle at project start

1. Do you continue in this repo, or start a new repo and reuse the design?
2. Which Supabase and Vercel projects are live, and are public sign-ups already disabled?
3. Who reads the weekly report, and does it need an Excel/PDF export?
4. Should reminders go beyond email (push, WhatsApp, etc.)?
5. Is Turkish-only fine, or is a second UI language needed?
