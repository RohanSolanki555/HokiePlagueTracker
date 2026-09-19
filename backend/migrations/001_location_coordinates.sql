-- Apply once in the Supabase SQL editor against the existing locations/reports tables.
-- Coordinates belong to saved locations. reports.location_id remains the join key.
begin;

alter table public.locations
    add column if not exists latitude double precision,
    add column if not exists longitude double precision;

alter table public.locations
    add constraint locations_latitude_range check (latitude between -90 and 90),
    add constraint locations_longitude_range check (longitude between -180 and 180),
    add constraint locations_coordinate_pair check (
        (latitude is null) = (longitude is null)
    );

create index if not exists reports_location_created_at_idx
    on public.reports (location_id, created_at);
create index if not exists reports_created_at_idx
    on public.reports (created_at);

commit;
