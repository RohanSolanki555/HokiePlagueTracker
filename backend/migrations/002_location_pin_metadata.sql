-- Apply once in the Supabase SQL editor, after 001_location_coordinates.sql.
-- Stores Google place metadata for locations created from a dropped map pin.
begin;

alter table public.locations
    add column if not exists place_id text,
    add column if not exists formatted_address text,
    add column if not exists place_types text[],
    add column if not exists address_components jsonb;

-- One saved location per Google place; locations without a place ID are unrestricted.
create unique index if not exists locations_place_id_key
    on public.locations (place_id) where place_id is not null;

commit;
