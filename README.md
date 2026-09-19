# HokiePlagueTracker

## Login setup

Follow [Supabase auth setup](supabase/AUTH_SETUP.md) before running the app.
It includes the VT-only signup migration, Auth hook, redirect URLs, email delivery,
and frontend public-key configuration. Dashboard and reporting now require login.

Tracks illness reports around Virginia Tech in Blacksburg, Virginia. React + TypeScript + Vite render the dashboard; Flask reads locations and reports from Supabase.

The dashboard starts at Virginia Tech (37.2296, -80.4139). Enter another latitude/longitude, choose a radius and report period, or pan the Google map and select **Search this area**. Pins show report counts. Selecting a pin or a location in the list shows its counts, average severity, and change from the previous period.

## Local setup

Use Python 3.10+ and a Node version supported by Vite 8 (Node 22.12+ or a current supported release).

Backend (macOS/Linux/WSL):

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set SUPABASE_URL, SUPABASE_SECRET_KEY and GOOGLE_MAPS_API_KEY in .env.
python run.py
```

Backend (Windows PowerShell):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
Copy-Item .env.example .env
# Set SUPABASE_URL, SUPABASE_SECRET_KEY and GOOGLE_MAPS_API_KEY in .env.
python run.py
```

If PowerShell blocks activation, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. Windows has no system timezone database, which is why `tzdata` is in `requirements.txt`.

Frontend, in a second terminal:

```sh
cd frontend
npm ci
cp .env.example .env
# Set VITE_GOOGLE_MAPS_API_KEY in .env.
npm run dev
```

Keep the Supabase secret key in `backend/.env`; it must never use a `VITE_` variable. Restart Vite after changing frontend environment variables.

## Google Maps setup

1. In your Google Cloud project, enable billing and the **Maps JavaScript API**, then create a browser API key.
2. Restrict that key to the Maps JavaScript API and your website origins (for development, `http://localhost:5173/*`; add your deployed website separately).
3. Put the key in `frontend/.env` as `VITE_GOOGLE_MAPS_API_KEY`.
4. Set `VITE_GOOGLE_MAPS_MAP_ID` to a JavaScript map ID. `DEMO_MAP_ID` works for development; create your own map ID for production.

The browser key is visible in the frontend by design, so its website and API restrictions matter. The map itself needs no Geocoding or Places API: the center is chosen by coordinates or by panning the map. Saving a dropped pin (below) does use the **Geocoding API**, called only from Flask with a separate server key. See Google's [loader documentation](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [advanced marker setup](https://developers.google.com/maps/documentation/javascript/advanced-markers/start), and [key restrictions](https://developers.google.com/maps/api-security-best-practices).

If the map key is absent or Google cannot load, the location list and statistics can still work through Flask. Database errors are displayed as errors, not zero reports.

## Database coordinates

The integration uses the existing API's table contract:

| Table | Required columns |
| --- | --- |
| `locations` | `id`, `name`, `location_type`, `latitude`, `longitude` |
| `reports` | `id`, `location_id`, `severity` (numeric), `created_at` (timestamp) |

`reports.location_id` must reference `locations.id`. Coordinates only position a saved location; reports are always joined by ID, so two entries at the same coordinates retain separate statistics.

Run [001_location_coordinates.sql](backend/migrations/001_location_coordinates.sql) **once** in the Supabase SQL editor. It adds nullable coordinate columns, validates coordinate ranges/pairs, and indexes report lookups. It assumes the existing `locations` and `reports` tables already exist. The repository does not contain their original schema. If your database already stores coordinates under different column names, migrate those values into `latitude` and `longitude` before using the map.

Populate both coordinate fields on the desired **existing location rows** using Supabase's table editor. Leave both null until a location's coordinates are known. The migration does not invent locations, insert sample illness reports, or overwrite existing coordinates. Locations without valid coordinates are excluded from the map and area totals, with their count shown in the dashboard.

No live database migration is run by application startup. Local checks use test fixtures; live Supabase and Google access require your configured credentials.

## Saving a pin

Use **Report an illness** above the dashboard map: enter a full street address, select an illness and severity, then select **Submit report**. Flask geocodes the address, saves or reuses its location, and inserts a report linked to that location. The dashboard centers on the pin and refreshes its report count. Multiple reports at the same Google place share one pin; each saved report adds to the count. The selected radius and report period are preserved.

Reported locations are shared map pins, visible to other users. Unmatched, ambiguous, or incomplete address results ask the user to refine the address before saving a report. The lower-level `/api/locations/pin` endpoint still saves a location without submitting an illness report.

This uses the existing location migrations below; no new migration is required. Flask also continues to accept dropped coordinates and Google place IDs. Address lookup follows Google's [Geocoding API](https://developers.google.com/maps/documentation/geocoding/requests-geocoding).

1. In Google Cloud, enable the **Geocoding API** (and **Places API (New)** for real place names) and create a **second, server-side key** restricted to that API. Do not reuse the browser key (browser keys are usually restricted by website, which Flask requests can't satisfy).
2. Put it in `backend/.env` as `GOOGLE_MAPS_API_KEY`.
3. Run [002_location_pin_metadata.sql](backend/migrations/002_location_pin_metadata.sql) once in the Supabase SQL editor, after 001. It adds `place_id`, `formatted_address`, `place_types` and `address_components` to `locations`.

```text
POST /api/locations/lookup   preview address or pin metadata, saves nothing
POST /api/locations/pin      look up the metadata and save it to Supabase
```

Body (JSON): `address` (1-500 characters), **or** `latitude` and `longitude` together, and/or `place_id` (the ID Google Maps gives when a user clicks a place). Optional `name` and `location_type` (`Academic`, `Dining`, `Recreation`, `Residence`, `Off Campus`, `Other`) override what Google suggests; otherwise the name is the place's name from Google's Places API (New) when that API is enabled for the key (falling back to the street address, since the Geocoding API only returns addresses) and the type comes from Google's place types, defaulting to `Other`. When `address` or only `place_id` is sent, coordinates come from Google. Do not combine `address` with coordinates or a place ID.

For example: `POST /api/locations/pin` with `{"address":"225 Stanger St, Blacksburg, VA 24060"}`.

`/pin` returns `{"location": {...}, "created": true}` with HTTP 201. Pinning a place that is already saved (same `place_id`) returns the existing row with HTTP 200 instead of a duplicate. Errors: 400 invalid input, 404 Google has no address there, 502 Google failed, 503 server key missing or database unavailable.

## Map API and statistics

```text
GET /api/locations/map?latitude=37.2296&longitude=-80.4139&radius_km=3&days=7
```

Defaults are the values shown above. Supply latitude and longitude together. Latitude must be -90–90, longitude -180–180, radius 0.1–100 km, and days an integer from 1–30. Invalid queries return HTTP 400; unavailable database data returns HTTP 503.

The response includes `center`, `radius_km`, `days`, `generated_at`, `unmapped_locations`, an area `summary`, and `locations`. Each location retains its database `id`, coordinates, distance from the search center, and a `stats` object:

```json
{
  "total_reports": 6,
  "reports_today": 2,
  "previous_period_reports": 3,
  "change_percent": 100,
  "average_severity": 2.5,
  "latest_report_at": "2026-09-19T11:00:00+00:00"
}
```

The example is illustrative. Counts use a rolling `days` window and compare against the immediately preceding window of equal length. “Today” starts at midnight in `America/New_York`. Future reports are excluded. A percentage change from zero to a nonzero count is `null` and displayed as “New reports”; two empty periods produce 0%. Severity is the mean of non-null numeric scores in the current period; no scores produce `null`.

The existing `/api/stats/summary` returns actual database totals across all locations, with `weekly_change` nullable when there is no prior baseline. The dashboard uses the map endpoint so its displayed totals match its selected area. Pin labels, nearby-location counts, and summary cards all use the same saved-report counts for the selected period. They refresh immediately after a successful submission, every 15 seconds while the page is visible, and when the user returns to the tab. Counts are calculated from report rows, so failed submissions never increment them.

Location creation and report insertion are separate database requests. If report insertion fails, a location with zero reports may remain, but no report is counted.

Queries paginate locations and reports to avoid Supabase row-limit truncation. This implementation is intended for campus-scale data; it reads saved locations to calculate distance and aggregates matching reports in Flask. For a much larger dataset, move the distance filter and aggregation into an indexed PostGIS query or database function.

## Checks

```sh
cd backend
python -m pytest -q   # with the venv activated
```

```sh
cd frontend
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Browser tests run two local Vite instances, with and without a test map key. They mock the Google Maps API and Flask responses, exercising pins, selection, coordinate/radius/period filters, failures, and mobile layout without calling billable Google services. Backend tests exercise coordinate validation, joins, paging, date boundaries, and API responses with a fake Supabase client.
Tracks illness in virginia tech students across Blacksburg, Virginia

## Illness reporting setup

After creating the `locations`, `symptoms`, `reports`, and `report_symptoms`
tables, run `supabase/migrations/202609190001_report_details.sql` in the
Supabase SQL editor. It adds address and illness text to reports without
removing existing data, and restricts direct report access to the backend.

Configure `backend/.env` with `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`GOOGLE_MAPS_API_KEY`, and `FRONTEND_URL=http://localhost:5173`. Reporting now
uses the same server-side address lookup and location migrations described above.
Keep the secret keys on the backend.
Configure `frontend/.env` with `VITE_API_URL=http://localhost:5000/api`.

Start the backend from `backend/` with `python run.py` after installing
`requirements.txt`. Start the frontend from `frontend/` with `npm install`
and `npm run dev`.

Use the **Report an illness** form directly above the dashboard map.
After saving, the dashboard centers and selects the reported location.

The report form saves an address, an illness selected from a dropdown, and
severity (1–5) through `POST /api/reports`. The backend resolves the address and
sets `location_id` to the matching saved location. Clients do not need to select
a location ID. The selected illness name is stored on the report; it does not
populate the `report_symptoms` join table.

A successful submission returns HTTP 201 with `{ "report": { "id", "location_id",
"severity", "created_at" }, "location": { "id", "name", "location_type", "latitude",
"longitude" } }` (field names shown schematically). Private report address and
illness fields remain excluded from report responses; the resolved location is
public map data. The returned location lets the frontend select the pin and
reload its current statistics. Older reports with no `location_id` are preserved
and are not automatically backfilled onto the map.

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
