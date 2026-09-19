-- Apply once in the Supabase SQL editor, after 003_dorms_and_private_home_reports.sql.
-- Safe to re-run: a dorm whose name already exists is skipped.
--
-- Coordinates come from Google Places. Wings Google does not list separately use the
-- position of the whole building (marked "approx."); correct them in the Table Editor if
-- you have better points. floors is left null until known: the report form then asks
-- for a floor number (1-60) instead of offering a list. Set it per dorm with, e.g.:
--   update public.locations set floors = 14 where is_dorm and name = 'Pritchard';
begin;

insert into public.locations (name, location_type, is_dorm, latitude, longitude)
select v.name, 'Residence', true, v.latitude, v.longitude
from (values
    ('Ambler Johnston (East)',   37.22319, -80.42060),
    ('Ambler Johnston (West)',   37.22305, -80.42102),
    ('Campbell (East)',          37.22636, -80.42157),  -- approx.: Campbell Hall
    ('Campbell (Main)',          37.22610, -80.42194),
    ('CID',                      37.22759, -80.41700),
    ('Cochrane',                 37.22268, -80.42207),
    ('Eggleston (East)',         37.22768, -80.41941),
    ('Eggleston (Main)',         37.22744, -80.42010),  -- approx.: Eggleston Hall
    ('Eggleston (West)',         37.22744, -80.42030),  -- approx.: Eggleston Hall, nudged 20 m so pins do not overlap
    ('GLC at Donaldson Brown',   37.22827, -80.41751),
    ('Harper',                   37.22273, -80.42318),
    ('Hillcrest',                37.22384, -80.42504),
    ('Hoge',                     37.22450, -80.41851),
    ('Johnson',                  37.22554, -80.41773),
    ('Miles',                    37.22561, -80.41688),
    ('New Hall West',            37.22224, -80.42256),
    ('New Residence Hall East',  37.22570, -80.41907),
    ('Newman',                   37.22622, -80.41782),
    ('O''Shaughnessy',           37.22538, -80.41826),
    ('Payne',                    37.22581, -80.42000),
    ('Pearson (East)',           37.23090, -80.41879),
    ('Pearson (West)',           37.23023, -80.42000),
    ('Peddrew-Yates',            37.22508, -80.41978),
    ('Pritchard',                37.22420, -80.41944),
    ('Slusher',                  37.22516, -80.42216),
    ('Vawter',                   37.22684, -80.41765),
    ('Whitehurst',               37.22625, -80.41687)
) as v(name, latitude, longitude)
where not exists (
    select 1 from public.locations existing
    where existing.is_dorm and existing.name = v.name
);

commit;
