# HokiePlagueTracker
Tracks illness in virginia tech students across Blacksburg, Virginia

## Illness reporting setup

After creating the `locations`, `symptoms`, `reports`, and `report_symptoms`
tables, run `supabase/migrations/202609190001_report_details.sql` in the
Supabase SQL editor. It adds address and illness text to reports without
removing existing data, and restricts direct report access to the backend.

Configure `backend/.env` with `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`FRONTEND_URL=http://localhost:5173`. Keep the secret key on the backend.
Configure `frontend/.env` with `VITE_API_URL=http://localhost:5000/api`.

Start the backend from `backend/` with `python run.py` after installing
`requirements.txt`. Start the frontend from `frontend/` with `npm install`
and `npm run dev`.

The dashboard form saves an address, an illness selected from a dropdown, and
severity (1–5) through `POST /api/reports`. `location_id` is optional and
refers to an existing location category. The selected illness name is stored on
the report; it does not populate the `report_symptoms` join table.
Addresses and illness descriptions are excluded from report API responses.
The dashboard summary cards remain placeholders.

No additional Supabase SQL is needed for the illness dropdown after the migration
above has been applied: it uses the existing `reports.illness` text column.
The API validates new submissions against the dropdown's allowed illnesses.
Selecting Flu reveals an optional Flu A / Flu B dropdown. The API accepts
`flu_type: "A"` or `"B"` only with `illness: "Flu"`, and stores `Flu A` or
`Flu B` in `reports.illness`. Leaving the type unspecified stores `Flu`.
This also needs no additional SQL. Changing illnesses clears the flu selection.
Existing reports are preserved; the `symptoms` and `report_symptoms` tables
can remain in place and are not used by this form.

Run backend tests from `backend/` with `python -m pytest tests`.
Run frontend checks from `frontend/` with `npm run build` and `npm run lint`.
