-- Run in the Supabase SQL editor after creating the placeholder tables.
-- Existing reports retain NULL details; new submissions require both fields in the API.
begin;

alter table public.reports
    add column if not exists address text
        check (address is null or char_length(btrim(address)) between 1 and 500),
    add column if not exists illness text
        check (illness is null or char_length(btrim(illness)) between 1 and 200);

-- Reports contain private addresses. Access them through the backend secret key.
alter table public.reports enable row level security;
revoke all on table public.reports from anon, authenticated;
grant select, insert on table public.reports to service_role;

commit;
