CREATE TABLE assignments(
 id INTEGER PRIMARY KEY,
 lesson_id INTEGER NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 instructions TEXT NOT NULL,
 rubric TEXT NOT NULL,
 submission_type TEXT NOT NULL CHECK(submission_type IN ('text','url','file')),
 max_score INTEGER NOT NULL DEFAULT 100 CHECK(max_score BETWEEN 1 AND 1000),
 required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1))
);
CREATE TABLE assignment_submissions(
 id INTEGER PRIMARY KEY,
 assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id),
 body TEXT NOT NULL DEFAULT '',
 attachment_id INTEGER REFERENCES materials(id),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','revision','approved')),
 score INTEGER,
 feedback TEXT NOT NULL DEFAULT '',
 rubric_scores TEXT NOT NULL DEFAULT '{}',
 submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 UNIQUE(assignment_id,user_id)
);
CREATE INDEX ix_assignment_submissions_status ON assignment_submissions(status,submitted_at);
ALTER TABLE materials ADD COLUMN private_owner INTEGER REFERENCES users(id);
CREATE TABLE course_versions(
 id INTEGER PRIMARY KEY,
 course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 snapshot TEXT NOT NULL,
 change_note TEXT NOT NULL DEFAULT '',
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(course_id,version)
);
CREATE TABLE learning_goals(
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 weekly_minutes INTEGER NOT NULL DEFAULT 120 CHECK(weekly_minutes BETWEEN 15 AND 2400),
 reminder_time TEXT NOT NULL DEFAULT '18:00',
 reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminder_enabled IN (0,1)),
 last_reminded_on TEXT
);
