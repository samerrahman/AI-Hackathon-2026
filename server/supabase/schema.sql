-- Teach Stu accounts: the tables, policies and storage bucket behind "My topics".
--
-- Paste this whole file into the Supabase SQL editor (Dashboard → SQL Editor → New query) and run it.
-- It is idempotent: running it again changes nothing and never deletes data. See docs/ACCOUNTS.md.
--
-- Security model: the browser talks to Supabase directly with the signed-in user's access token and the
-- public anon key. Row-level security is what keeps one account's topics and notes away from another's,
-- so every policy below is limited to auth.uid(). The app never uses a service-role key.

-- ---------------------------------------------------------------------------------------------------------
-- 1. Saved study sessions: one row per topic, per account.
-- ---------------------------------------------------------------------------------------------------------
create table if not exists public.study_sessions (
  -- The owner. Filled in from the caller's token when omitted; deleting the auth user deletes their rows.
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- The topic id the Teach Stu API issued (a UUID string). Unique per account, not globally.
  id         text        not null,
  -- Summary columns for the My topics list, so it never has to download whole sessions.
  name       text        not null,
  depth      text        not null,  -- big-picture | exam-ready | expert
  mode       text        not null,  -- live | demo (a bundled sample)
  status     text        not null,  -- active | paused | completed
  percent    int         not null default 0,
  -- The whole saved session without document blobs: extracted note text, the conversation, the draft, and the
  -- opaque encrypted state token. The original PDFs and pasted text live in the notes bucket below.
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  -- Bumped by every save. A browser saves only over the version it last saw, so a stale tab or device can never
  -- overwrite newer teaching (or bring back a deleted topic); see saveTopic in web/src/lib/cloud.ts.
  version    int         not null default 0,
  primary key (user_id, id)
);

-- Projects that ran an earlier copy of this file get the column too.
alter table public.study_sessions add column if not exists version int not null default 0;

-- Bounds on what one row may hold, so nobody can fill the database through the public API. The app's own values
-- are far inside them: topic ids are UUIDs, titles are at most 160 characters, and a session's data is at most the
-- 8 MB of notes the study API accepts, plus the conversation.
alter table public.study_sessions drop constraint if exists study_sessions_bounds;
alter table public.study_sessions add constraint study_sessions_bounds check (
  length(id) between 1 and 64
  and length(name) between 1 and 200
  and depth in ('big-picture', 'exam-ready', 'expert')
  and mode in ('live', 'demo')
  and status in ('active', 'paused', 'completed')
  and percent between 0 and 100
  and version >= 0
  and octet_length(data::text) <= 10485760  -- 10 MB
);

comment on table public.study_sessions is 'Teach Stu: one saved study session (topic) per row, readable only by its owner.';

-- My topics lists an account's topics newest first.
create index if not exists study_sessions_user_updated_idx on public.study_sessions (user_id, updated_at desc);

-- Row-level security: each account sees and changes only its own rows.
alter table public.study_sessions enable row level security;

drop policy if exists "Own study sessions" on public.study_sessions;
create policy "Own study sessions" on public.study_sessions
  for all                      -- select, insert, update and delete
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Google sign-in only. The app turns every other way in off (docs/ACCOUNTS.md, step 3), and this restrictive policy
-- is the backstop: an email/password, phone or anonymous user's token is refused here even if one gets made.
drop policy if exists "Google accounts only" on public.study_sessions;
create policy "Google accounts only" on public.study_sessions
  as restrictive
  for all
  to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
  with check (coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

-- At most 200 topics per account. Runs as the caller, so it counts only rows the caller can see: their own.
create or replace function public.study_sessions_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.study_sessions where user_id = new.user_id) >= 200 then
    raise exception 'Teach Stu keeps at most 200 topics per account. Delete one to start another.';
  end if;
  return new;
end;
$$;

drop trigger if exists study_sessions_limit on public.study_sessions;
create trigger study_sessions_limit
  before insert on public.study_sessions
  for each row execute function public.study_sessions_limit();

-- Signed-in users need table privileges for RLS to apply to them; the anon role gets nothing.
grant select, insert, update, delete on public.study_sessions to authenticated;
revoke all on public.study_sessions from anon;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Original notes: a private bucket. Objects are stored as <user_id>/<session_id>/<document_id>.<pdf|txt>.
-- ---------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notes', 'notes', false, 20971520, array['application/pdf', 'text/plain'])  -- 20 MB, like the app's limit
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies: an account may read, add, replace and delete objects only inside its own folder, whose
-- name (the first path segment) is its user id. New and replaced objects must also have the app's own path shape,
-- <user id>/<session id>/<document id>.<pdf|txt>, and an account may keep at most 1,200 notes (200 topics of up to
-- 5 files each, with room to spare).
drop policy if exists "Read own notes" on storage.objects;
create policy "Read own notes" on storage.objects
  for select to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Add own notes" on storage.objects;
create policy "Add own notes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'notes'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_.-]{1,64}/[A-Za-z0-9_.-]{1,64}\.(pdf|txt)$')
    and (select count(*) from storage.objects as mine
         where mine.bucket_id = 'notes' and (storage.foldername(mine.name))[1] = auth.uid()::text) < 1200
  );

-- Uploads use upsert, which needs update as well as insert.
drop policy if exists "Replace own notes" on storage.objects;
create policy "Replace own notes" on storage.objects
  for update to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'notes'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_.-]{1,64}/[A-Za-z0-9_.-]{1,64}\.(pdf|txt)$')
  );

drop policy if exists "Delete own notes" on storage.objects;
create policy "Delete own notes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Google sign-in only, as for the table above. Restrictive, and limited to this bucket so other buckets are untouched.
drop policy if exists "Google accounts only (notes)" on storage.objects;
create policy "Google accounts only (notes)" on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'notes' or (coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false))
  with check (bucket_id <> 'notes' or (coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google' and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false));
