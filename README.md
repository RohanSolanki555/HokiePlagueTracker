# HokiePlagueTracker

## Login setup

Follow [Supabase auth setup](supabase/AUTH_SETUP.md) before running the app.
It includes the VT-only signup migration, Auth hook, redirect URLs, email delivery,
and frontend public-key configuration. Dashboard and reporting now require login.

Tracks illness reports around Virginia Tech in Blacksburg, Virginia. React + TypeScript + Vite render the dashboard; Flask reads locations and reports from Supabase.

The dashboard shows the last seven days of reports within 3 km of the [Virginia Tech Drillfield](https://www.coordinatesfinder.com/coordinates/13540-virginia-tech-drill-field-blacksburg-va) (37.2274294, -80.4222303). Pan and zoom the map, then select **Center on Drillfield** to return to campus. The reporting area stays centered on the Drillfield. Controls below the map filter by **30 days**, **14 days**, or **7 days**, and change the circle radius. They update immediately; the period also applies to summary and dorm statistics. Pins show report counts. Selecting a pin or a location in the list shows its counts, average severity, and change from the previous period.

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
| `locations` | `id`, `name`, `location_type`, `latitude`, `longitude`, plus `is_dorm` and `floors` (migration 003) |
| `reports` | `id`, `location_id` (null for off-campus reports), `severity` (numeric), `created_at` (timestamp), `illness`, plus `residence_type`, `floor`, `area_latitude`, `area_longitude` (migration 003) |

`reports.location_id` must reference `locations.id`. Coordinates only position a saved location; reports are always joined by ID, so two entries at the same coordinates retain separate statistics.

Run [001_location_coordinates.sql](backend/migrations/001_location_coordinates.sql) **once** in the Supabase SQL editor. It adds nullable coordinate columns, validates coordinate ranges/pairs, and indexes report lookups. It assumes the existing `locations` and `reports` tables already exist. The repository does not contain their original schema. If your database already stores coordinates under different column names, migrate those values into `latitude` and `longitude` before using the map.

Populate both coordinate fields on the desired **existing location rows** using Supabase's table editor. Leave both null until a location's coordinates are known. The migration does not invent locations, insert sample illness reports, or overwrite existing coordinates. Locations without valid coordinates are excluded from the map and area totals, with their count shown in the dashboard.

No live database migration is run by application startup. Local checks use test fixtures; live Supabase and Google access require your configured credentials.

## Dorms and private home reports

The dashboard's **Virginia Tech dorms** section lists every dorm with its report count. Selecting a dorm (from the list or its map pin) shows its totals, average severity, change from the prior period, and charts of illnesses reported, reports per day, and reports by floor.

**Report an illness** asks where the person is staying:

- **On-campus dorm:** a dorm and floor from the database's dorm list. The report is linked to that dorm (`location_id`) and counted in its statistics.
- **Off campus:** a street address, geocoded once by Flask. Only the centre of a ~550 m grid cell is stored (`area_latitude`/`area_longitude`, see `blur_to_area` in `map_service.py`). The address is **not** stored, no `locations` row is created, and the API never returns the exact position. These reports appear on the map as small gray dots that cannot be clicked, have no name or tooltip, and still count toward the area totals.

Dorms are rows in `locations` with `is_dorm = true` and a `floors` count. Run [003_dorms_and_private_home_reports.sql](backend/migrations/003_dorms_and_private_home_reports.sql) once (after 001 and 002), then run [004_seed_vt_dorms.sql](backend/migrations/004_seed_vt_dorms.sql), which adds the 27 Virginia Tech dorms with coordinates (safe to re-run; existing names are skipped). Each dorm row is a `locations` row with `name`, `location_type` = `Residence`, `is_dorm` = true, `latitude`, `longitude` and an optional `floors`. While `floors` is null the report form asks for a floor number instead of offering a list; set it per dorm in the Table Editor. The map only sends dorm locations, so any older address-named rows in `locations` stay hidden; review them in the Supabase table editor and delete the ones that are home addresses. Older `reports.address` values are not removed by the migration.

```text
GET  /api/dorms?days=7        every dorm with its statistics
GET  /api/dorms/<id>?days=7   one dorm: stats, illnesses, daily counts, floors
POST /api/reports             dorm: {residence_type:"dorm", dorm_id, floor, illness, severity[, flu_type]}
                              home: {residence_type:"home", address, illness, severity[, flu_type]}
```

Report responses contain only `{"report": {id, location_id, severity, created_at}}`. Errors: 400 invalid input or unknown dorm, 404 address not found, 502 Google failed, 503 storage unavailable.

## Saving a pin

The lower-level pin endpoints are separate from illness reports. Flask accepts an address, dropped coordinates or a Google place ID and can save the result as a location. Address lookup follows Google's [Geocoding API](https://developers.google.com/maps/documentation/geocoding/requests-geocoding). Do not save a person's home address through `/api/locations/pin`: that creates a location row.

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

Defaults are the values shown above. Supply latitude and longitude together. Latitude must be -90–90, longitude -180–180, radius 0.1–100 km, and days `all` or an integer from 1–30. Invalid queries return HTTP 400; unavailable database data returns HTTP 503.

The response includes `center`, `radius_km`, `days`, `generated_at`, `unmapped_locations` (dorms without coordinates), an area `summary`, `home_areas` (anonymous cells: `latitude`, `longitude`, `reports`), and `locations` (dorms only). Each location retains its database `id`, coordinates, distance from the search center, and a `stats` object:

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

The existing `/api/stats/summary` returns actual database totals across all locations, with `weekly_change` nullable when there is no prior baseline. The dashboard uses the map endpoint so its displayed totals match its selected area. Pin labels, dorm counts, and summary cards all use the same saved-report counts for the selected period; the summary also includes off-campus reports inside the search radius. They refresh immediately after a successful submission, every 15 seconds while the page is visible, and when the user returns to the tab. Counts are calculated from report rows, so failed submissions never increment them.

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
