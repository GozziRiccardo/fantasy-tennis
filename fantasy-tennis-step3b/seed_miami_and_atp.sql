-- ============================================================
-- FANTASY TENNIS — Step 3b: Miami + seed ATP players
-- Esegui nel Supabase SQL Editor
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. MIAMI OPEN 2026
-- Cambia le date se necessario
-- total_rounds = 6 (Masters 1000, draw da 96 giocatori)
-- api_tournament_id: da aggiornare una volta trovato su API-Tennis
-- ────────────────────────────────────────────────────────────
insert into public.tournaments (name, type, start_date, end_date, total_rounds, status)
values ('Miami Open 2026', 'masters1000', '2026-03-19', '2026-04-05', 6, 'upcoming')
on conflict do nothing;


-- ────────────────────────────────────────────────────────────
-- 2. SEED ATP TOP 30
-- (la pagina Admin cerca tra questi — aggiungi gli altri
--  manualmente dalla pagina Admin o estendi questa lista)
-- I prezzi seguono la formula: ceil((100 - ranking) / 10)
-- ────────────────────────────────────────────────────────────
insert into public.atp_players (name, ranking, price) values
  ('Jannik Sinner',                1,  10),
  ('Carlos Alcaraz',               2,  10),
  ('Novak Djokovic',               3,  10),
  ('Alexander Zverev',             4,   9),
  ('Daniil Medvedev',              5,   9),
  ('Casper Ruud',                  6,   9),
  ('Andrey Rublev',                7,   9),
  ('Hubert Hurkacz',               8,   9),
  ('Grigor Dimitrov',              9,   9),
  ('Alex Bublik',                 10,   9),
  ('Taylor Fritz',                11,   9),
  ('Tommy Paul',                  12,   9),
  ('Stefanos Tsitsipas',          13,   9),
  ('Ben Shelton',                 14,   9),
  ('Holger Rune',                 15,   9),
  ('Frances Tiafoe',              16,   9),
  ('Sebastian Korda',             17,   9),
  ('Felix Auger-Aliassime',       18,   9),
  ('Ugo Humbert',                 19,   9),
  ('Alejandro Davidovich Fokina', 20,   8),
  ('Nicolas Jarry',               21,   8),
  ('Francisco Cerundolo',         22,   8),
  ('Karen Khachanov',             23,   8),
  ('Tomas Machac',                24,   8),
  ('Jakub Mensik',                25,   8),
  ('Lorenzo Musetti',             26,   8),
  ('Jack Draper',                 27,   8),
  ('Flavio Cobolli',              28,   8),
  ('Arthur Fils',                 29,   8),
  ('Matteo Berrettini',           30,   7),
  ('Alexei Popyrin',              31,   7),
  ('Brandon Nakashima',           32,   7),
  ('Nuno Borges',                 33,   7),
  ('Mariano Navone',              34,   7),
  ('Giovanni Mpetshi Perricard',  35,   7),
  ('Jordan Thompson',             36,   7),
  ('Tallon Griekspoor',           37,   7),
  ('Jan-Lennard Struff',          38,   7),
  ('Marcos Giron',                39,   7),
  ('Jiri Lehecka',                40,   6),
  ('Christopher Eubanks',         41,   6),
  ('Roberto Bautista Agut',       42,   6),
  ('Laslo Djere',                 43,   6),
  ('David Goffin',                44,   6),
  ('Luciano Darderi',             45,   6),
  ('Camilo Ugo Carabelli',        46,   6),
  ('Alexander Bublik',            47,   6),
  ('Pedro Martinez',              48,   6),
  ('Gael Monfils',                49,   6),
  ('Denis Shapovalov',            50,   5),
  ('Miomir Kecmanovic',           51,   5),
  ('Stan Wawrinka',               52,   5),
  ('Fabio Fognini',               53,   5),
  ('Pablo Carreno Busta',         54,   5),
  ('Alex Michelsen',              55,   5),
  ('Luca Van Assche',             56,   5),
  ('Alexandre Muller',            57,   5),
  ('Borna Coric',                 58,   5),
  ('Thanasi Kokkinakis',          59,   5),
  ('Maximilian Marterer',         60,   4),
  ('Sebastian Baez',              61,   4),
  ('Adrian Mannarino',            62,   4),
  ('Yoshihito Nishioka',          63,   4),
  ('Quentin Halys',               64,   4),
  ('Yannick Hanfmann',            65,   4),
  ('Nicolas Mahut',               66,   4),
  ('Constant Lestienne',          67,   4),
  ('Dusan Lajovic',               68,   4),
  ('Gregoire Barrere',            69,   4),
  ('Fernando Verdasco',           70,   3),
  ('Peter Gojowczyk',             71,   3),
  ('James Duckworth',             72,   3),
  ('Juan Manuel Cerundolo',       73,   3),
  ('Maxime Cressy',               74,   3),
  ('Alexander Ritschard',         75,   3),
  ('Roman Safiullin',             76,   3),
  ('Richard Gasquet',             77,   3),
  ('Hugo Dellien',                78,   3),
  ('Dominic Thiem',               79,   3),
  ('Rinky Hijikata',              80,   2),
  ('Alexander Zverev Jr',         81,   2),
  ('Emilio Gomez',                82,   2),
  ('Facundo Bagnis',              83,   2),
  ('Henri Laaksonen',             84,   2),
  ('Aleksandar Kovacevic',        85,   2),
  ('Geoffrey Blancaneaux',        86,   2),
  ('Thiago Agustin Tirante',      87,   2),
  ('Wu Yibing',                   88,   2),
  ('Bernabe Zapata Miralles',     89,   2),
  ('Sumit Nagal',                 90,   1),
  ('Harold Mayot',                91,   1),
  ('Dalibor Svrcina',             92,   1),
  ('Christopher O''Connell',      93,   1),
  ('Daniel Elahi Galan',          94,   1),
  ('Jozef Kovalik',               95,   1),
  ('Camille Lestienne',           96,   1),
  ('Pablo Andujar',               97,   1),
  ('Jurij Rodionov',              98,   1),
  ('Marc-Andrea Huesler',         99,   1),
  ('Taro Daniel',                100,   1)
on conflict (name) do update
  set ranking = excluded.ranking,
      price   = excluded.price,
      updated_at = now();


-- ────────────────────────────────────────────────────────────
-- 3. VERIFICA
-- ────────────────────────────────────────────────────────────
-- select count(*) from public.atp_players;    -- dovrebbe essere 100
-- select * from public.tournaments order by start_date;
