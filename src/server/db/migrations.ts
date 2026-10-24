/**
 * Schema migrations, applied in order. Never edit a migration that has shipped;
 * add a new entry to the end of the list instead.
 */
export const migrations: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    email                TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    name                 TEXT    NOT NULL,
    title                TEXT    NOT NULL DEFAULT '',
    password_hash        TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    color                TEXT    NOT NULL DEFAULT 'blue',
    is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL,
    last_login_at        TEXT
  );

  CREATE TABLE sessions (
    id           TEXT    PRIMARY KEY,            -- SHA-256 of the cookie token
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL,
    last_seen_at TEXT    NOT NULL,
    user_agent   TEXT    NOT NULL DEFAULT '',
    ip           TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX sessions_user_idx ON sessions (user_id);
  CREATE INDEX sessions_expires_idx ON sessions (expires_at);

  CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT 'blue',
    status      TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
    start_date  TEXT,
    due_date    TEXT,
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'todo'
                         CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
    priority     TEXT    NOT NULL DEFAULT 'medium'
                         CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    start_date   TEXT,
    due_date     TEXT,
    position     INTEGER NOT NULL DEFAULT 0,     -- order within (project, status)
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX tasks_board_idx ON tasks (project_id, status, position);
  CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, status);
  CREATE INDEX tasks_due_idx ON tasks (due_date);

  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );
  CREATE INDEX comments_task_idx ON comments (task_id, created_at);

  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY,
    type       TEXT    NOT NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    data       TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT    NOT NULL
  );
  CREATE INDEX activity_created_idx ON activity (created_at);
  CREATE INDEX activity_project_idx ON activity (project_id, created_at);
  CREATE INDEX activity_task_idx ON activity (task_id, created_at);
  `,

  /* 2: invitation and password reset links. Invited people who haven't joined yet have an empty password_hash. */ `
  CREATE TABLE user_tokens (
    id         TEXT    PRIMARY KEY,              -- SHA-256 of the token in the link
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT    NOT NULL CHECK (purpose IN ('invite', 'reset')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    emailed_at TEXT                              -- NULL when the link was shared by hand
  );
  CREATE INDEX user_tokens_user_idx ON user_tokens (user_id, purpose);
  CREATE INDEX user_tokens_expires_idx ON user_tokens (expires_at);
  `,
];
