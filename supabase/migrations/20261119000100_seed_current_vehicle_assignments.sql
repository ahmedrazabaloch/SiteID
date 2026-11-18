-- Current FormulaOne vehicle roster. `route` stores the roster's zone area.
-- The primary key (route, field_shift) keeps Day and Night assignments separate.
insert into public.route_vehicles (
  route, field_shift, team, vehicle_number, driver, fueler_supervisor, notes, updated_at
)
values
  ('Lyari', 'day', '', 'KQ-6012', 'Bilawal', 'Irfan Dada', '', now()),
  ('Gulshan', 'day', '', 'KQ-6013', 'Zawar', 'Adnan', '', now()),
  ('Nazimabad', 'day', '', 'KQ-6016', 'Miandad', 'Azhar', '', now()),
  ('Korangi', 'day', '', 'JP-9377', 'Imran', 'Gulfam', '', now()),
  ('North Nazimabad', 'day', '', 'KP-5109', 'Haji M.', 'Asif', '', now()),
  ('DHA', 'day', '', 'KT-9123', 'Khaliq', 'Sajjad', '', now()),
  ('Baldia', 'day', '', 'KQ-5627', 'Saifullah', 'Kashif', '', now()),
  ('North-N & Gulshan', 'night', '', 'KT9121', 'Sawal', 'M.Ali', '', now()),
  ('Korangi & DHA', 'night', '', 'KT9123', 'Nabi Bux', 'Mumtaz', '', now()),
  ('Baldia & Lyari', 'night', '', 'KQ6017', 'Fida', 'Shahid', '', now())
on conflict (route, field_shift) do update set
  team = excluded.team,
  vehicle_number = excluded.vehicle_number,
  driver = excluded.driver,
  fueler_supervisor = excluded.fueler_supervisor,
  notes = excluded.notes,
  updated_at = now();
