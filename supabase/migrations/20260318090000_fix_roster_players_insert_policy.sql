-- Ensure roster inserts from Admin page pass RLS for the configured admin user
-- while still allowing normal users to manage only their own roster rows.

drop policy if exists "roster_players_admin_all" on public.roster_players;
drop policy if exists "roster_players_authenticated_insert" on public.roster_players;

create policy "roster_players_select_owner_or_admin"
on public.roster_players
for select
to authenticated
using (
  auth.uid() = user_id
  or (auth.jwt() ->> 'email') = 'ilgozzi@mail.com'
);

create policy "roster_players_insert_owner_or_admin"
on public.roster_players
for insert
to authenticated
with check (
  auth.uid() = user_id
  or (auth.jwt() ->> 'email') = 'ilgozzi@mail.com'
);

create policy "roster_players_update_owner_or_admin"
on public.roster_players
for update
to authenticated
using (
  auth.uid() = user_id
  or (auth.jwt() ->> 'email') = 'ilgozzi@mail.com'
)
with check (
  auth.uid() = user_id
  or (auth.jwt() ->> 'email') = 'ilgozzi@mail.com'
);

create policy "roster_players_delete_owner_or_admin"
on public.roster_players
for delete
to authenticated
using (
  auth.uid() = user_id
  or (auth.jwt() ->> 'email') = 'ilgozzi@mail.com'
);
