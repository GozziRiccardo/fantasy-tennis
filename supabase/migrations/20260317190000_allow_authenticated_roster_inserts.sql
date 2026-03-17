-- Allow authenticated app users to insert roster rows during auction/admin setup.
-- This resolves RLS errors when assigning players to users from the Admin page.

create policy if not exists "roster_players_authenticated_insert"
on public.roster_players
for insert
to authenticated
with check (true);
