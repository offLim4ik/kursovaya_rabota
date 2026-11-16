ALTER TABLE modules ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE modules ADD COLUMN outcomes TEXT NOT NULL DEFAULT '';
ALTER TABLE modules ADD COLUMN unlock_after_module_id INTEGER REFERENCES modules(id);
