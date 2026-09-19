# Enable VT login

1. Run `migrations/202609190003_vt_auth.sql` in the Supabase SQL editor.
   It adds a domain restriction function, a trusted password-setup flag,
   and profiles created after verification. Existing reports are unchanged.
2. In **Authentication > Hooks**, enable **Before User Created** and select
   the Postgres function `public.restrict_vt_signup`. Running SQL alone does
   not activate the signup hook. It blocks non-VT signups even via direct API calls.
3. Enable the **Email** provider and **Confirm email**. Set minimum password
   length to 8 or greater. Leave the magic-link template using `{{ .ConfirmationURL }}`.
4. Under **Authentication > URL Configuration**, set the site URL to
   `http://localhost:5173` and allow these redirect URLs:
   - `http://localhost:5173/auth/setup`
   - `http://localhost:5173/auth/reset`
   Add the corresponding HTTPS production URLs when deploying.
5. In `frontend/.env`, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings. Use the
   publishable key or legacy anon key, **never** the secret/service-role key.
   The backend continues using `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
6. Configure custom SMTP for real VT users. Supabase's default email delivery
   is restricted to project team addresses. Keep the project's email rate limits
   enabled. Restart Vite and Flask after configuring the environment.

## Flow

`/signup` sends a verification link. `/auth/setup` receives the verified session
and lets the user create and confirm a password. `/login` uses email/password;
`/forgot-password` sends a reset link to `/auth/reset`. Passwords go directly
to Supabase Auth, never to Flask or the profiles table.

Dashboard (`/` or `/dashboard`) and `/report` require a verified VT session
with password setup complete. Flask verifies bearer tokens with Supabase Auth
for every API request except `/api/health` and CORS preflights. Reports retain
no account UUID. Profile access is restricted to the account owner.

The password completion flag is derived from Auth's password/confirmation
fields by a database trigger, not from client-editable user metadata.
After migrating existing users, sign out and back in to refresh token metadata.

Configure the deployed frontend's SPA fallback to serve `index.html` for all
of the frontend routes above. Vite handles this locally.

## Verify after setup

- Try a non-VT signup: it should fail in the UI and via Supabase Auth directly.
- Sign up with a real VT inbox, open the link, and set matching passwords.
- Sign out, log back in with email/password, then submit a report.
- Request a password reset, open the link, and set a new password.
- Try an expired email link and confirm it offers a new link.
- Verify requests to `/api/reports` without a bearer token return 401.

References: [Supabase signup hooks](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook),
[magic links](https://supabase.com/docs/reference/javascript/auth-signinwithotp),
[password auth](https://supabase.com/docs/guides/auth/passwords),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
