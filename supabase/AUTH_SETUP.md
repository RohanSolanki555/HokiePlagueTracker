# Enable VT login

1. Run `migrations/202609190003_vt_auth.sql` in the Supabase SQL editor.
   It adds a domain restriction function, a trusted password-setup flag,
   and profiles created after verification. Existing reports are unchanged.
2. In **Authentication > Hooks**, enable **Before User Created** and select
   the Postgres function `public.restrict_vt_signup`. Running SQL alone does
   not activate the signup hook. It blocks non-VT signups even via direct API calls.
3. Enable the **Email** provider and **Confirm email**. Set minimum password
   length to 8 or greater. Under **Authentication > Email Templates**, paste
   `templates/recovery.html` into **Reset Password**, and `templates/verify.html`
   into both **Magic Link** and **Confirm Signup**. These templates use
   `{{ .TokenHash }}`, not `{{ .ConfirmationURL }}`. Saving files in this repo
   does not update your hosted email templates automatically.
4. Under **Authentication > URL Configuration**, set the site URL to
   `http://localhost:5173` and allow these redirect URLs:
   - `http://localhost:5173/auth/setup`
   - `http://localhost:5173/auth/reset`
   - `http://localhost:5173/auth/recovery`
   - `http://localhost:5173/auth/verify`
   Add the corresponding HTTPS production URLs when deploying.
   The templates use **Site URL** as their destination, so set it to your actual
   deployed frontend origin for friends using the app (no trailing slash).
   `localhost` links only work on the machine running Vite.
5. In `frontend/.env`, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's API settings. Use the
   publishable key or legacy anon key, **never** the secret/service-role key.
   The backend continues using `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
6. Configure custom SMTP for real VT users. Supabase's default email delivery
   is restricted to project team addresses. Keep the project's email rate limits
   enabled. Restart Vite and Flask after configuring the environment.

## Flow

`/signup` sends a link to `/auth/verify?token_hash=...`. Pressing **Continue**
verifies it with `verifyOtp({ token_hash, type: "email" })`, creates the session,
and replaces the URL with `/auth/setup` to create a password.
`/forgot-password` sends a link to `/auth/recovery?token_hash=...`. Pressing
**Continue** verifies it with `type: "recovery"`, then opens `/auth/reset`.
Neither confirmation page redeems tokens on load, including when already signed in.
This addresses mail scanners consuming links when they prefetch them.
`/login` still uses email/password. Passwords go directly to Supabase Auth.

No database migration is needed for these confirmation pages. Deploy the frontend
and update the hosted templates together, then request **fresh** emails. Already
sent links still use their old format; consumed or expired tokens cannot be restored.
Keep link tracking disabled at the email provider. If the hosting provider logs
full URLs, redact the `token_hash` query parameter from logs and analytics.

Dashboard (`/` or `/dashboard`), including its report form, requires a verified VT session
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
- Preview/open a new email link without pressing Continue; verify it remains usable.
- Verify requests to `/api/reports` without a bearer token return 401.

References: [Supabase signup hooks](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook),
[magic links](https://supabase.com/docs/reference/javascript/auth-signinwithotp),
[password auth](https://supabase.com/docs/guides/auth/passwords),
[SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
[Email prefetching and templates](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching),
[token verification](https://supabase.com/docs/reference/javascript/auth-verifyotp).
