-- 0029_lab_packages.sql — test packages: profiles and tests billed as one line.
--
-- Append-only: never edit once applied.
--
-- A package ("Whole Body Test") is billed at its own price and holds profiles
-- (LFT, CBC…) and single tests (owner, 2083-08-06). It is a lab_test_groups
-- row with kind = 'package', so everything that already asks "is this service
-- a lab test or profile?" (the counter, the day close, the books) treats a
-- package the same way without being told. Its single tests stay in
-- lab_test_group_items; the profiles it holds are listed here. A package
-- never holds another package.
--
-- When billed, a package opens one lab order row per test inside it, each
-- test once: a profile's tests carry the profile's name (they print under it),
-- the package's single tests print on their own.

ALTER TABLE lab_test_groups ADD COLUMN kind TEXT NOT NULL DEFAULT 'profile';

CREATE TABLE IF NOT EXISTS lab_test_group_profiles (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES lab_test_groups(id),   -- the package
  profile_id  TEXT NOT NULL REFERENCES lab_test_groups(id),   -- a profile in it
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_group_profiles_group ON lab_test_group_profiles (group_id, sort_order);
