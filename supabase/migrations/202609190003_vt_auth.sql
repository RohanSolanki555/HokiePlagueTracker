begin;

-- Enable this function in Authentication > Hooks > Before User Created.
create or replace function public.restrict_vt_signup(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
    if coalesce(event->'user'->>'email', '') !~* '^[^[:space:]@]+@vt\.edu$' then
        return '{"error":{"http_code":403,"message":"Use a Virginia Tech @vt.edu email address."}}'::jsonb;
    end if;
    return '{}'::jsonb;
end;
$$;
revoke execute on function public.restrict_vt_signup(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.restrict_vt_signup(jsonb) to supabase_auth_admin;

-- This flag is server-owned app metadata, not editable user metadata.
create or replace function public.mark_password_setup()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('password_setup_complete',
            new.email_confirmed_at is not null and coalesce(new.encrypted_password, '') <> '');
    return new;
end;
$$;
revoke execute on function public.mark_password_setup() from public, anon, authenticated;
drop trigger if exists mark_password_setup on auth.users;
create trigger mark_password_setup before insert or update on auth.users
for each row execute function public.mark_password_setup();

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create or replace function public.sync_verified_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.email_confirmed_at is not null and new.email ~* '^[^[:space:]@]+@vt\.edu$' then
        insert into public.profiles(id, email) values (new.id, new.email)
        on conflict (id) do update set email = excluded.email;
    end if;
    return new;
end;
$$;
revoke execute on function public.sync_verified_profile() from public, anon, authenticated;
drop trigger if exists sync_verified_profile on auth.users;
create trigger sync_verified_profile after insert or update on auth.users
for each row execute function public.sync_verified_profile();

-- Backfill existing users; no health reports are associated with accounts.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb);
commit;
