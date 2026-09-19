# HokiePlagueTracker

Tracks illness reports around Virginia Tech in Blacksburg, Virginia. React + TypeScript + Vite render the dashboard; Flask reads locations and reports from Supabase.

The dashboard starts at Virginia Tech (37.2296, -80.4139). Enter another latitude/longitude, choose a radius and report period, or pan the Google map and select **Search this area**. Pins show report counts. Selecting a pin or a location in the list shows its counts, average severity, and change from the previous period.

## Local setup

Use Python 3.10+ and a Node version supported by Vite 8 (Node 22.12+ or a current supported release).

Backend:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.
python run.py
```

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

The browser key is visible in the frontend by design, so its website and API restrictions matter. No Geocoding or Places API is needed: the center is chosen by coordinates or by panning the map. See Google's [loader documentation](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [advanced marker setup](https://developers.google.com/maps/documentation/javascript/advanced-markers/start), and [key restrictions](https://developers.google.com/maps/api-security-best-practices).

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

The existing `/api/stats/summary` now returns actual database totals across all locations, with `weekly_change` nullable when there is no prior baseline. The dashboard uses the map endpoint so its displayed totals match its selected area.

Queries paginate locations and reports to avoid Supabase row-limit truncation. This implementation is intended for campus-scale data; it reads saved locations to calculate distance and aggregates matching reports in Flask. For a much larger dataset, move the distance filter and aggregation into an indexed PostGIS query or database function.

## Checks

```sh
cd backend
.venv/bin/python -m pytest -q
```

```sh
cd frontend
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Browser tests run two local Vite instances, with and without a test map key. They mock the Google Maps API and Flask responses, exercising pins, selection, coordinate/radius/period filters, failures, and mobile layout without calling billable Google services. Backend tests exercise coordinate validation, joins, paging, date boundaries, and API responses with a fake Supabase client.
