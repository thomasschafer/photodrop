-- Migration 0007: Add profile_color column to users table
--
-- Each user gets a color for their avatar. New users are assigned a random color.
-- Existing users are assigned random colors from the 20-color palette.

-- Add the profile_color column with a default value
ALTER TABLE users ADD COLUMN profile_color TEXT NOT NULL DEFAULT 'terracotta';

-- Randomly assign colors to existing users
-- The 20 colors in order: terracotta, coral, amber, rust, clay, copper, sienna,
--                         sage, olive, forest, moss, jade,
--                         slate, ocean, teal, indigo,
--                         plum, wine, mauve, rose
UPDATE users SET profile_color = (
  CASE (abs(random()) % 20)
    WHEN 0 THEN 'terracotta'
    WHEN 1 THEN 'coral'
    WHEN 2 THEN 'amber'
    WHEN 3 THEN 'rust'
    WHEN 4 THEN 'clay'
    WHEN 5 THEN 'copper'
    WHEN 6 THEN 'sienna'
    WHEN 7 THEN 'sage'
    WHEN 8 THEN 'olive'
    WHEN 9 THEN 'forest'
    WHEN 10 THEN 'moss'
    WHEN 11 THEN 'jade'
    WHEN 12 THEN 'slate'
    WHEN 13 THEN 'ocean'
    WHEN 14 THEN 'teal'
    WHEN 15 THEN 'indigo'
    WHEN 16 THEN 'plum'
    WHEN 17 THEN 'wine'
    WHEN 18 THEN 'mauve'
    WHEN 19 THEN 'rose'
  END
);
