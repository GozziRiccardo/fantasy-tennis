-- Fix admin RLS permissions for roster management from the web Admin page.
-- The frontend admin identity is currently tied to this email.

create policy if not exists "roster_players_admin_all"
on public.roster_players
for all
to authenticated
using ((auth.jwt() ->> 'email') = 'ilgozzi@mail.com')
with check ((auth.jwt() ->> 'email') = 'ilgozzi@mail.com');

create policy if not exists "profiles_admin_read"
on public.profiles
for select
to authenticated
using ((auth.jwt() ->> 'email') = 'ilgozzi@mail.com');

create policy if not exists "profiles_admin_update"
on public.profiles
for update
to authenticated
using ((auth.jwt() ->> 'email') = 'ilgozzi@mail.com')
with check ((auth.jwt() ->> 'email') = 'ilgozzi@mail.com');
