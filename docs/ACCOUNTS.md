# Accounts: Google sign-in and saved topics

Teach Stu can require a free account past the front page. People sign in with Google through **Supabase Auth**, and their study sessions are saved to their account, so **My topics** follows them to any device.

Accounts are **off until both `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set** on the server. Without them, the app works exactly as before: no sign-in, and sessions saved only in the browser. Local development, the e2e suite, and any deployment that hasn't set the keys all run that way.

## How it works

- **Sign-in.** The browser reads the Supabase URL and anon key from `/api/config` (there are no `VITE_` variables), then runs Google OAuth with PKCE. Supabase sends people back to the page they came from with `?code=…`, which the app exchanges and removes from the address bar.
- **The API.** Every `/api` route except `/api/config` and `/api/health` needs `Authorization: Bearer <access token>`. The server first refuses, without any network call, a token that can't be a live access token (not a three-part JWT, over 8 KB, no `sub`, or already expired). It then checks the token with `GET <SUPABASE_URL>/auth/v1/user`, lets in only users who signed in with Google (not anonymous, email/password or phone users), and caches a valid answer for 60 seconds (keyed by a SHA-256 of the token). A missing or invalid token gets `401 AUTH_REQUIRED`; more than 30 failed checks from one IP in a minute get `429 AUTH_RATE_LIMIT`; if Supabase can't be reached, `503 AUTH_UNAVAILABLE`. A topic's sealed state records the account that started it, and another account's token is refused with `403 WRONG_ACCOUNT`. Study requests are limited to 60 per 10 minutes per account and 180 per IP.
- **Saved topics.** The browser writes directly to Supabase with the signed-in user's token: one row per topic in `public.study_sessions` (the session without the original files), and the original PDFs and pasted notes in the private `notes` bucket at `<user id>/<session id>/<document id>.<pdf|txt>`. Row-level security limits every read and write to the caller's own rows and folder. Saves run about 1.5 seconds after a new turn (up to 10 seconds after typing or turning a page), and at once when the tab is hidden or closed.
- **Versions.** Each save bumps the row's `version`, and a browser only saves over the version it last saw. A tab or device left open on an older state therefore can't overwrite newer teaching: it says the topic changed elsewhere and offers to open the latest version. A topic deleted on one device is closed on the others instead of being saved back.
- **This browser's copy.** The open topic is also kept in IndexedDB as a fast, offline copy, tagged with the account it belongs to; another account signing in on the same browser never sees it, and it is deleted then. Changes the account hasn't got yet (the tab closed first, or Supabase was down) are sent the next time the site opens. Signing out from the menu first saves what is waiting, asks before throwing away anything that couldn't be saved, and then clears the copy. Signing out in one tab closes the topic in every other tab.
- **Deleting.** A topic's delete button removes its row, then its files. **Delete my data** in the account menu removes every row and every file under the user's folder, then signs out. It can't remove the sign-in record itself (that needs a service-role key, which this app never uses); see [Removing someone completely](#removing-someone-completely).

Only the public **anon** (publishable) key is used, in the server and the browser. **Never put the `service_role` key in Vercel, `.env`, or the code.**

## Setup checklist

### 1. Create the Supabase project

1. At [supabase.com/dashboard](https://supabase.com/dashboard), create a project (any region; one near Vercel's function region keeps sign-in checks fast).
2. In **Project Settings → API** (or **Connect**), copy:
   - the **Project URL**, `https://<ref>.supabase.co`. `<ref>` is the project reference used below.
   - the **anon / publishable** key. Not the `service_role` / secret key.

### 2. Create the Google OAuth client

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or create a project.
2. **APIs & Services → OAuth consent screen**: user type **External**, app name **Teach Stu**, a support email, and authorized domains `brodidnot.study` and `<ref>.supabase.co` (your project's own domain: Google refuses plain `supabase.co`, which is a public suffix). The scopes needed are the defaults: `openid`, `email` and `profile`. Publish the app (or add test users while it is in testing).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**:
   - **Authorized JavaScript origins:** `https://www.brodidnot.study` (add `http://127.0.0.1:5173` for local testing).
   - **Authorized redirect URIs:** `https://<ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.

### 3. Turn on the Google provider in Supabase, and every other way in off

1. **Authentication → Sign In / Providers → Google**: enable it, paste the client ID and client secret, and save. The client secret goes only here: never in Vercel, `.env` or the code.
2. On the same page, turn **Email** off (new projects have it on) and keep **Phone** off.
3. Keep **Allow anonymous sign-ins** off (**Authentication → Sign In / Providers**, under the user signups settings).

The anon key is public (`/api/config` hands it to every browser), so with Email on anyone could make a password account through Supabase's API. The server and the database refuse those accounts anyway (only Google sign-ins get in), but turning them off keeps them from being made at all.

### 4. Set the URL configuration

**Authentication → URL Configuration**:

- **Site URL:** `https://www.brodidnot.study`
- **Redirect URLs:**
  - `https://www.brodidnot.study/**`
  - `https://ai-hackathon-2026-two.vercel.app/**` (the production alias)
  - `https://*-samerrahmans-projects.vercel.app/**` (Vercel preview deployments)
  - `http://127.0.0.1:5173/**` (local `npm run dev`)

The app sends people back to the page they signed in from, as `https://<host>/` (with the trailing slash: a `/**` pattern only matches a URL that has a path). Supabase allows the Site URL's own host and loopback addresses such as `127.0.0.1` even without a pattern; every other origin that should allow sign-in has to be listed, or Supabase sends people to the Site URL instead and the sign-in can't finish there.

### 5. Create the table, policies and bucket

Open **SQL Editor → New query**, paste all of [`server/supabase/schema.sql`](../server/supabase/schema.sql), and run it. It is idempotent: running it again changes nothing and never deletes data. It creates:

- `public.study_sessions`, keyed by `(user_id, id)`, with a `version` column, an index on `(user_id, updated_at desc)`, bounds on each row (id up to 64 characters, name up to 200, data up to 10 MB, known depth, mode and status values) and at most 200 topics per account;
- row-level security: `auth.uid() = user_id` for select, insert, update and delete, plus a restrictive policy that lets in only Google sign-ins;
- the private `notes` bucket (20 MB per file; `application/pdf` and `text/plain` only) and storage policies limited to the caller's own `<user id>/` folder, to the app's path shape `<user id>/<session id>/<document id>.<pdf|txt>`, and to 1,200 files per account, again for Google sign-ins only.

Ran an earlier copy of the file? Run the new one: it adds the `version` column and the new limits in place.

### 6. Set the environment variables

| Where | Variables |
| --- | --- |
| Vercel → Project → Settings → Environment Variables (Production **and** Preview) | `SUPABASE_URL=https://<ref>.supabase.co` and `SUPABASE_ANON_KEY=<anon key>` |
| Local `.env` (optional) | the same two lines |

Never give them a `VITE_` prefix: the browser gets them from `/api/config`. Redeploy on Vercel (or restart `npm run dev`) after setting them. Set both or neither; with only one, accounts stay off.

### 7. Verify

1. `curl https://www.brodidnot.study/api/config` shows `"auth":{"url":"https://<ref>.supabase.co","anonKey":"…"}`.
2. `curl -X POST https://www.brodidnot.study/api/topic` returns `401` with `"code":"AUTH_REQUIRED"`.
3. Open the site in a private window. The front page shows, and the start card says **Sign in to start teaching Stu** with **Continue with Google**. **Try a sample**, **or just start talking**, **Test Stu’s expressions** and the settings button open a sign-in dialog.
4. Continue with Google. You come back signed in: the account button shows your email, and the start card shows the topic form.
5. Start a topic (a sample is fine) and send one explanation. The workspace header says **Saved to your account**. In Supabase, **Table Editor → study_sessions** has a row for it, and **Storage → notes** has a `<your user id>/<topic id>/` folder with the notes.
6. Go back to the front page: **My topics** lists the topic. Open the site on another browser or device, sign in, and resume it from there.
7. Sign in with a second Google account. It sees none of the first account's topics.
8. Open the same topic in two tabs, teach in one, then teach in the other: the second says the topic changed elsewhere and offers **Open the latest version**.
9. Delete the topic from **My topics**, then try **Delete my data**: the row and the files disappear, and you are signed out.

## Turning accounts off

Remove `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Vercel and redeploy. Sign-in disappears and sessions are saved only in each browser again. Topics already in Supabase stay there until you delete them.

## Removing someone completely

**Delete my data** removes a person's topics and files but not their sign-in record. To remove that too, delete the user in **Authentication → Users**; their `study_sessions` rows go with it (`on delete cascade`). Storage objects don't cascade, so also delete their `<user id>/` folder in **Storage → notes** if it still exists.

## Tests

`npm test` covers token checks (local refusals, Google only, the 60-second cache), the failed-check and per-IP limits, route protection and the account binding (`server/auth.test.ts`, with Supabase mocked). `tests/accounts.spec.ts` runs the signed-out gate, the sign-in redirect, loading and server-down states, My topics, saving and its failures, versions across two devices, deletion on another device, sign-out across tabs and on a phone, signing in again, and the privacy copy, against a stub Supabase in the browser. No test calls a real Supabase project.
