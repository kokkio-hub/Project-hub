/**
 * A migration that rebuilds a table other tables point to (to change a CHECK
 * constraint, for example) must run with foreign keys switched off: otherwise
 * dropping the old table would cascade into the tables that reference it.
 */
export interface Migration {
  sql: string;
  foreignKeysOff?: boolean;
}

/**
 * Schema migrations, applied in order. Never edit a migration that has shipped;
 * add a new entry to the end of the list instead.
 */
export const migrations: (string | Migration)[] = [
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

  /*
   * 3: guests, private projects, custom columns, labels, checklists, dependencies,
   * attachments, notifications, recurring tasks, templates, the trash, two-factor
   * sign-in, calendar feeds and backup status.
   */
  {
    foreignKeysOff: true,
    sql: `
  -- People: a "guest" role, notification and two-factor settings, a calendar feed.
  CREATE TABLE users_new (
    id                   INTEGER PRIMARY KEY,
    email                TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    name                 TEXT    NOT NULL,
    title                TEXT    NOT NULL DEFAULT '',
    password_hash        TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'guest')),
    color                TEXT    NOT NULL DEFAULT 'blue',
    is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at           TEXT    NOT NULL,
    updated_at           TEXT    NOT NULL,
    last_login_at        TEXT,
    notify_email         TEXT    NOT NULL DEFAULT 'daily' CHECK (notify_email IN ('instant', 'daily', 'off')),
    tz_offset_minutes    INTEGER,                -- the person's UTC offset, last seen from their browser
    digest_sent_on       TEXT,                   -- local date of the last daily email
    totp_secret          TEXT,                   -- two-factor secret once switched on
    totp_pending_secret  TEXT,                   -- secret being set up, not yet confirmed
    totp_enabled_at      TEXT,
    totp_last_counter    INTEGER,                -- last code used, so a code can't be replayed
    calendar_token_hash  TEXT    UNIQUE,         -- SHA-256 of the secret in the calendar feed address
    calendar_scope       TEXT    NOT NULL DEFAULT 'mine' CHECK (calendar_scope IN ('mine', 'all'))
  );
  INSERT INTO users_new (id, email, name, title, password_hash, role, color, is_active, must_change_password,
                         created_at, updated_at, last_login_at)
       SELECT id, email, name, title, password_hash, role, color, is_active, must_change_password,
              created_at, updated_at, last_login_at
         FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;

  ALTER TABLE sessions ADD COLUMN last_active_at TEXT;
  UPDATE sessions SET last_active_at = last_seen_at;

  CREATE TABLE login_challenges (
    id         TEXT    PRIMARY KEY,              -- SHA-256 of the token handed to the browser
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE recovery_codes (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT    NOT NULL,
    used_at   TEXT
  );
  CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id);

  -- Projects: private projects with members, templates, and the trash.
  ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'private'));
  ALTER TABLE projects ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0 CHECK (is_template IN (0, 1));
  ALTER TABLE projects ADD COLUMN deleted_at TEXT;
  ALTER TABLE projects ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

  CREATE TABLE project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX project_members_user_idx ON project_members (user_id);

  -- Board columns. Each belongs to one of the four stages, so progress and the dashboard keep working.
  CREATE TABLE project_columns (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    stage      TEXT    NOT NULL CHECK (stage IN ('todo', 'in_progress', 'review', 'done')),
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );
  CREATE INDEX project_columns_project_idx ON project_columns (project_id, position);
  INSERT INTO project_columns (project_id, name, stage, position, created_at)
       SELECT p.id, s.name, s.stage, s.pos, p.created_at
         FROM projects p
        CROSS JOIN (SELECT 'To do' AS name, 'todo' AS stage, 0 AS pos
                    UNION ALL SELECT 'In progress', 'in_progress', 1
                    UNION ALL SELECT 'In review', 'review', 2
                    UNION ALL SELECT 'Done', 'done', 3) s
        ORDER BY p.id, s.pos;

  -- Tasks: their column, the trash, and repeating.
  ALTER TABLE tasks ADD COLUMN column_id INTEGER REFERENCES project_columns(id) ON DELETE SET NULL;
  UPDATE tasks SET column_id = (SELECT c.id FROM project_columns c WHERE c.project_id = tasks.project_id AND c.stage = tasks.status);
  CREATE INDEX tasks_column_idx ON tasks (column_id, position);
  ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
  ALTER TABLE tasks ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'yearly'));
  ALTER TABLE tasks ADD COLUMN recurrence_interval INTEGER;
  ALTER TABLE tasks ADD COLUMN next_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

  CREATE TABLE labels (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT 'blue',
    created_at TEXT    NOT NULL
  );
  CREATE UNIQUE INDEX labels_name_idx ON labels (project_id, name COLLATE NOCASE);

  CREATE TABLE task_labels (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );
  CREATE INDEX task_labels_label_idx ON task_labels (label_id);

  CREATE TABLE checklist_items (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body         TEXT    NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    position     INTEGER NOT NULL DEFAULT 0,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL,
    completed_at TEXT,
    completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX checklist_task_idx ON checklist_items (task_id, position);

  CREATE TABLE task_dependencies (
    blocker_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
  );
  CREATE INDEX task_dependencies_blocked_idx ON task_dependencies (blocked_id);

  CREATE TABLE attachments (
    id           INTEGER PRIMARY KEY,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    filename     TEXT    NOT NULL,
    stored_name  TEXT    NOT NULL UNIQUE,         -- random file name in the attachments folder
    mime_type    TEXT    NOT NULL,
    size         INTEGER NOT NULL,
    created_at   TEXT    NOT NULL,
    backed_up_at TEXT                             -- when it was copied to the backup bucket
  );
  CREATE INDEX attachments_task_idx ON attachments (task_id, created_at);

  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    data       TEXT    NOT NULL DEFAULT '{}',
    dedupe_key TEXT,                              -- stops the same reminder being created twice
    created_at TEXT    NOT NULL,
    read_at    TEXT,
    emailed_at TEXT
  );
  CREATE INDEX notifications_user_idx ON notifications (user_id, created_at);
  CREATE INDEX notifications_unemailed_idx ON notifications (user_id) WHERE emailed_at IS NULL AND read_at IS NULL;
  CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

  -- Small bits of state the server keeps between restarts (last backup, for example).
  CREATE TABLE app_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  },
  /* 4: interface language, subtasks, milestones, custom fields, saved views */ `
  -- language: the person's choice (NULL = automatic); ui_language: what they last used the app in.
  ALTER TABLE users ADD COLUMN language TEXT;
  ALTER TABLE users ADD COLUMN ui_language TEXT;

  -- Subtasks are tasks with a parent in the same project (one level deep).
  ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
  CREATE INDEX tasks_parent_idx ON tasks (parent_id) WHERE parent_id IS NOT NULL;

  CREATE TABLE milestones (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    reached_at  TEXT,                              -- set when someone marks it reached
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );
  CREATE INDEX milestones_project_idx ON milestones (project_id, date);
  ALTER TABLE tasks ADD COLUMN milestone_id INTEGER REFERENCES milestones(id) ON DELETE SET NULL;
  CREATE INDEX tasks_milestone_idx ON tasks (milestone_id) WHERE milestone_id IS NOT NULL;

  CREATE TABLE custom_fields (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    type         TEXT    NOT NULL CHECK (type IN ('text', 'number', 'select', 'date', 'checkbox')),
    options      TEXT    NOT NULL DEFAULT '[]',     -- dropdown choices: [{"id", "name", "color"}]
    show_on_card INTEGER NOT NULL DEFAULT 0 CHECK (show_on_card IN (0, 1)),
    position     INTEGER NOT NULL,
    created_at   TEXT    NOT NULL
  );
  CREATE INDEX custom_fields_project_idx ON custom_fields (project_id, position);

  CREATE TABLE task_field_values (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value    TEXT    NOT NULL,
    PRIMARY KEY (task_id, field_id)
  ) WITHOUT ROWID;
  CREATE INDEX task_field_values_field_idx ON task_field_values (field_id);

  -- A person's saved filter and display settings for a project.
  CREATE TABLE saved_views (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    view       TEXT    NOT NULL CHECK (view IN ('board', 'list', 'timeline', 'calendar')),
    settings   TEXT    NOT NULL DEFAULT '{}',
    position   INTEGER NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );
  CREATE INDEX saved_views_user_idx ON saved_views (user_id, position);
  `,
];
