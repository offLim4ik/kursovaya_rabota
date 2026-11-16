ALTER TABLE courses ADD COLUMN progression TEXT NOT NULL DEFAULT 'sequential' CHECK(progression IN ('sequential','free'));
