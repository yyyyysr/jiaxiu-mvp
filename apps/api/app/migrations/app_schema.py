import sqlite3

SCHEMA_VERSION = 5

SCHEMA_V1_STATEMENTS = (
    """
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('contributor', 'admin')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      token_digest TEXT NOT NULL UNIQUE,
      csrf_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE submissions (
      submission_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(user_id),
      submission_type TEXT NOT NULL CHECK (submission_type IN ('new_work', 'existing_work_scan')),
      existing_work_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'needs_revision', 'published', 'rejected')),
      title TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL DEFAULT '',
      poem_text TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '',
      historical_period TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT '', published_work_id TEXT,
      reviewer_user_id TEXT REFERENCES users(user_id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT NOT NULL,
      published_at TEXT
    )
    """,
    """
    CREATE TABLE submission_files (
      file_id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
      storage_name TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
      file_format TEXT NOT NULL CHECK (file_format IN ('jpg', 'png')),
      media_type TEXT NOT NULL, file_bytes INTEGER NOT NULL,
      pixel_width INTEGER NOT NULL, pixel_height INTEGER NOT NULL,
      sha256 TEXT NOT NULL, sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (submission_id, sha256), UNIQUE (submission_id, sequence)
    )
    """,
    """
    CREATE TABLE submission_revisions (
      revision_id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
      actor_user_id TEXT NOT NULL REFERENCES users(user_id),
      action TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE audit_events (
      event_id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(user_id),
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      detail_json TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX submissions_owner_status ON submissions(owner_user_id, status, updated_at DESC)",
    "CREATE INDEX submissions_review_queue ON submissions(status, submitted_at ASC)",
    "CREATE INDEX audit_events_created ON audit_events(created_at DESC)",
)

SCHEMA_V2_STATEMENTS = (
    """
    CREATE TABLE submission_file_cleanup (
      cleanup_id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      file_id TEXT NOT NULL UNIQUE,
      storage_name TEXT NOT NULL,
      file_format TEXT NOT NULL CHECK (file_format IN ('jpg', 'png')),
      attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0 AND attempt_count <= 1000000),
      created_at TEXT NOT NULL,
      last_attempt_at TEXT
    )
    """,
    "CREATE INDEX submission_file_cleanup_created ON submission_file_cleanup(created_at)",
)

SCHEMA_V3_STATEMENTS = (
    """
    CREATE TABLE submission_file_cleanup_v3 (
      cleanup_id TEXT PRIMARY KEY
        CHECK (length(cleanup_id) = 32 AND cleanup_id NOT GLOB '*[^0-9a-f]*'),
      submission_id TEXT NOT NULL
        CHECK (length(submission_id) = 32 AND submission_id NOT GLOB '*[^0-9a-f]*'),
      file_id TEXT NOT NULL UNIQUE
        CHECK (length(file_id) = 32 AND file_id NOT GLOB '*[^0-9a-f]*'),
      storage_name TEXT NOT NULL
        CHECK (storage_name = file_id || '.' || file_format),
      file_format TEXT NOT NULL CHECK (file_format IN ('jpg', 'png')),
      attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0 AND attempt_count <= 1000000),
      created_at TEXT NOT NULL,
      last_attempt_at TEXT
    )
    """,
    """
    INSERT INTO submission_file_cleanup_v3 (
      cleanup_id, submission_id, file_id, storage_name, file_format,
      attempt_count, created_at, last_attempt_at
    )
    SELECT cleanup_id, submission_id, file_id, storage_name, file_format,
           attempt_count, created_at, last_attempt_at
    FROM submission_file_cleanup
    WHERE length(cleanup_id) = 32 AND cleanup_id NOT GLOB '*[^0-9a-f]*'
      AND length(submission_id) = 32 AND submission_id NOT GLOB '*[^0-9a-f]*'
      AND length(file_id) = 32 AND file_id NOT GLOB '*[^0-9a-f]*'
      AND file_format IN ('jpg', 'png')
      AND storage_name = file_id || '.' || file_format
      AND attempt_count BETWEEN 0 AND 1000000
    """,
    "DROP TABLE submission_file_cleanup",
    "ALTER TABLE submission_file_cleanup_v3 RENAME TO submission_file_cleanup",
    "CREATE INDEX submission_file_cleanup_created ON submission_file_cleanup(created_at)",
)

SCHEMA_V4_STATEMENTS = (
    """
    CREATE TABLE submission_file_reconciliation_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      directory_cursor TEXT NOT NULL DEFAULT '' CHECK (length(directory_cursor) <= 255),
      entry_cursor TEXT NOT NULL DEFAULT '' CHECK (length(entry_cursor) <= 255),
      last_directories_examined INTEGER NOT NULL DEFAULT 0
        CHECK (last_directories_examined BETWEEN 0 AND 1000),
      last_entries_examined INTEGER NOT NULL DEFAULT 0
        CHECK (last_entries_examined BETWEEN 0 AND 1000),
      updated_at TEXT NOT NULL DEFAULT ''
    )
    """,
    """
    INSERT INTO submission_file_reconciliation_state (
      singleton, directory_cursor, entry_cursor,
      last_directories_examined, last_entries_examined, updated_at
    ) VALUES (1, '', '', 0, 0, '')
    """,
)

SCHEMA_V5_STATEMENTS = (
    """
    ALTER TABLE audit_events ADD COLUMN public_request_ref_v1 TEXT
      CHECK (
        public_request_ref_v1 IS NULL
        OR (
          length(public_request_ref_v1) = 32
          AND public_request_ref_v1 NOT GLOB '*[^0-9a-f]*'
        )
        OR (
          length(public_request_ref_v1) = 36
          AND substr(public_request_ref_v1, 1, 4) = 'cli-'
          AND substr(public_request_ref_v1, 5) NOT GLOB '*[^0-9a-f]*'
        )
        OR (
          length(public_request_ref_v1) = 43
          AND substr(public_request_ref_v1, 1, 11) = 'repository-'
          AND substr(public_request_ref_v1, 12) NOT GLOB '*[^0-9a-f]*'
        )
      )
    """,
    """
    CREATE TABLE submission_file_staging_inventory (
      inventory_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id TEXT NOT NULL UNIQUE
        CHECK (length(reservation_id) = 32 AND reservation_id NOT GLOB '*[^0-9a-f]*'),
      submission_id TEXT NOT NULL
        CHECK (length(submission_id) = 32 AND submission_id NOT GLOB '*[^0-9a-f]*'),
      file_id TEXT NOT NULL UNIQUE
        CHECK (length(file_id) = 32 AND file_id NOT GLOB '*[^0-9a-f]*'),
      storage_name TEXT NOT NULL
        CHECK (storage_name = file_id || '.' || file_format),
      file_format TEXT NOT NULL CHECK (file_format IN ('jpg', 'png')),
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE INDEX submission_file_staging_inventory_created
    ON submission_file_staging_inventory(created_at, inventory_sequence)
    """,
    "DROP TABLE submission_file_reconciliation_state",
    """
    CREATE TABLE submission_file_legacy_reconciliation_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      revision_id_cursor TEXT NOT NULL DEFAULT ''
        CHECK (
          revision_id_cursor = ''
          OR (
            length(revision_id_cursor) = 32
            AND revision_id_cursor NOT GLOB '*[^0-9a-f]*'
          )
        ),
      snapshot_file_cursor INTEGER NOT NULL DEFAULT 0
        CHECK (snapshot_file_cursor BETWEEN 0 AND 10),
      last_revisions_examined INTEGER NOT NULL DEFAULT 0
        CHECK (last_revisions_examined BETWEEN 0 AND 1000),
      last_candidates_examined INTEGER NOT NULL DEFAULT 0
        CHECK (last_candidates_examined BETWEEN 0 AND 10000),
      updated_at TEXT NOT NULL DEFAULT ''
    )
    """,
    """
    INSERT INTO submission_file_legacy_reconciliation_state (
      singleton, generation, revision_id_cursor, snapshot_file_cursor,
      last_revisions_examined, last_candidates_examined, updated_at
    ) VALUES (1, 0, '', 0, 0, 0, '')
    """,
    """
    CREATE TABLE submission_file_legacy_reconciliation_seen (
      revision_id TEXT NOT NULL
        CHECK (length(revision_id) = 32 AND revision_id NOT GLOB '*[^0-9a-f]*'),
      file_id TEXT NOT NULL
        CHECK (length(file_id) = 32 AND file_id NOT GLOB '*[^0-9a-f]*'),
      processed_at TEXT NOT NULL,
      PRIMARY KEY (revision_id, file_id)
    )
    """,
)


def migrate_schema(connection: sqlite3.Connection) -> None:
    current_version = connection.execute("PRAGMA user_version").fetchone()[0]
    if current_version > SCHEMA_VERSION:
        raise RuntimeError("Application database schema version is newer than this application")
    if current_version < 1:
        for statement in SCHEMA_V1_STATEMENTS:
            connection.execute(statement)
        connection.execute("PRAGMA user_version = 1")
        current_version = 1
    if current_version < 2:
        for statement in SCHEMA_V2_STATEMENTS:
            connection.execute(statement)
        connection.execute("PRAGMA user_version = 2")
        current_version = 2
    if current_version < 3:
        for statement in SCHEMA_V3_STATEMENTS:
            connection.execute(statement)
        connection.execute("PRAGMA user_version = 3")
        current_version = 3
    if current_version < 4:
        for statement in SCHEMA_V4_STATEMENTS:
            connection.execute(statement)
        connection.execute("PRAGMA user_version = 4")
        current_version = 4
    if current_version < 5:
        for statement in SCHEMA_V5_STATEMENTS:
            connection.execute(statement)
        connection.execute("PRAGMA user_version = 5")
