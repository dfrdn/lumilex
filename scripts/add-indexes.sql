-- Add missing matter_id indexes for detail page queries
CREATE INDEX IF NOT EXISTS idx_tasks_matter    ON tasks (matter_id);
CREATE INDEX IF NOT EXISTS idx_meetings_matter ON meetings (matter_id);
CREATE INDEX IF NOT EXISTS idx_hearings_matter ON hearings (matter_id);
CREATE INDEX IF NOT EXISTS idx_files_matter    ON files (matter_id);

-- Composite index for DTR queries that filter by lawyer + date range
CREATE INDEX IF NOT EXISTS idx_dtr_lawyer_date ON dtr (lawyer_name, date);

-- Drop stale columns from team (now computed live)
ALTER TABLE team DROP COLUMN IF EXISTS active_matter_count;
ALTER TABLE team DROP COLUMN IF EXISTS pending_deliverables;

-- Add notion_page_id to attendance (stores real Notion page UUID after write-back)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- Schema Completion Migration — add all missing Notion properties
-- ═══════════════════════════════════════════════════════════════════

-- ── clients (+9 columns) ──────────────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tin TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_number TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS point_persons TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS discount NUMERIC(5,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS receivables NUMERIC(12,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT FALSE;

-- ── matters (+9 columns) ──────────────────────────────────────────
ALTER TABLE matters ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS case_title TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS case_number TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS court TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS case_description TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT '';

-- ── tasks (+2 columns) ───────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ;

-- ── meetings (+2 columns) ────────────────────────────────────────
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS duration NUMERIC(5,1);

-- ── hearings (+3 columns) ────────────────────────────────────────
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS related_deliverable_id TEXT;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS is_attended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hearings ADD COLUMN IF NOT EXISTS is_filed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── deliverables (+4 columns) ────────────────────────────────────
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS date_done DATE;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS parent_deliverable_id TEXT;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS related_hearing_id TEXT;

-- ── files (+2 columns) ───────────────────────────────────────────
ALTER TABLE files ADD COLUMN IF NOT EXISTS acted_upon_by_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE files ADD COLUMN IF NOT EXISTS persons_read_ids TEXT[] NOT NULL DEFAULT '{}';

-- ── announcements (+2 columns) ───────────────────────────────────
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS announcement_date DATE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';

-- ── dtr (+1 column) ──────────────────────────────────────────────
ALTER TABLE dtr ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── team (+3 columns) ────────────────────────────────────
ALTER TABLE team ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE team ADD COLUMN IF NOT EXISTS mobile_number TEXT NOT NULL DEFAULT '';
ALTER TABLE team ADD COLUMN IF NOT EXISTS start_date DATE;

-- ═══════════════════════════════════════════════════════════════════
-- New tables
-- ═══════════════════════════════════════════════════════════════════

-- 14. Directory
CREATE TABLE IF NOT EXISTS directory (
  notion_id             TEXT PRIMARY KEY,
  notion_url            TEXT NOT NULL DEFAULT '',
  name                  TEXT NOT NULL DEFAULT '',
  contact_number        TEXT NOT NULL DEFAULT '',
  email_address         TEXT NOT NULL DEFAULT '',
  notion_last_edited_at TIMESTAMPTZ,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directory_name ON directory (name);

-- 15. Feedbacks
CREATE TABLE IF NOT EXISTS feedbacks (
  notion_id             TEXT PRIMARY KEY,
  notion_url            TEXT NOT NULL DEFAULT '',
  subject               TEXT NOT NULL DEFAULT '',
  type                  TEXT NOT NULL DEFAULT '',
  feedback_date         TIMESTAMPTZ,
  message               TEXT NOT NULL DEFAULT '',
  response              TEXT NOT NULL DEFAULT '',
  notion_last_edited_at TIMESTAMPTZ,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_date ON feedbacks (feedback_date DESC);
