-- Apply once in the Supabase SQL editor, after 001 and 002.
-- Dorms are rows in public.locations flagged is_dorm. A report is either a dorm
-- report (location_id + floor) or a home report, which stores only a blurred
-- map cell and never an address or a locations row.
begin;

alter table public.locations
    add column if not exists is_dorm boolean not null default false,
    add column if not exists floors integer;

alter table public.locations
    drop constraint if exists locations_floors_range,
    add constraint locations_floors_range check (floors is null or floors between 1 and 60);

alter table public.reports
    add column if not exists residence_type text,
    add column if not exists floor integer,
    add column if not exists area_latitude double precision,
    add column if not exists area_longitude double precision;

alter table public.reports
    drop constraint if exists reports_residence_type_check,
    drop constraint if exists reports_floor_range,
    drop constraint if exists reports_area_pair,
    add constraint reports_residence_type_check check (residence_type is null or residence_type in ('dorm', 'home')),
    add constraint reports_floor_range check (floor is null or floor between 1 and 60),
    add constraint reports_area_pair check ((area_latitude is null) = (area_longitude is null));

-- Home reports have no location row, and no longer store the street address.
alter table public.reports alter column location_id drop not null;
alter table public.reports alter column address drop not null;

create index if not exists reports_residence_created_at_idx
    on public.reports (residence_type, created_at);

commit;
