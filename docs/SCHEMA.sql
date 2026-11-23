CREATE TABLE ai_limits(
  scope TEXT PRIMARY KEY,
  requests_per_day INTEGER NOT NULL,
  tokens_per_month INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_outputs(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('group_summary','cross_group','discussion_points')),
  group_id TEXT,
  scope_json TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0,
  original_json TEXT NOT NULL,
  edited_json TEXT,
  sources_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','edited','reviewed','published')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  published_at INTEGER,
  generation_ms INTEGER
);

CREATE TABLE ai_usage(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  output_id TEXT,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','error','invalid_output')),
  error_code TEXT,
  http_status INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  request_key TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE attachments(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id TEXT,
  owner_participant_id TEXT,
  owner_user_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('entry','resource')),
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE auth_sessions(
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('staff','participant')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  participant_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE entries(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  question_id TEXT,
  author_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('text','table')),
  body TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  table_json TEXT,
  attachment_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  client_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  hidden_at INTEGER,
  hidden_by TEXT
);

CREATE TABLE entry_versions(
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  question_id TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  table_json TEXT,
  attachment_id TEXT,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(entry_id, version)
);

CREATE TABLE "group_moves"(
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  from_group_id TEXT,
  to_group_id TEXT,
  moved_by TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE group_stage_settings(
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  availability_override TEXT CHECK(availability_override IS NULL OR availability_override IN ('locked','open','closed')),
  excluded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(group_id, stage_id)
);

CREATE TABLE group_synthesis(
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, stage_id)
);

CREATE TABLE group_synthesis_versions(
  group_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, stage_id, version)
);

CREATE TABLE groups(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  pin_hash TEXT,
  seat_cap INTEGER CHECK(seat_cap IS NULL OR seat_cap > 0),
  representative_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE participants(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id),
  display_name TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  recovery_lookup TEXT UNIQUE, -- sha256 of the 16-character private recovery code (80 bits of entropy); the code itself is never stored
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
, recovery_enc TEXT);

CREATE TABLE peer_comments(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('entry','publication')),
  target_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_group_id TEXT,
  prompt_key TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','hidden')),
  created_at INTEGER NOT NULL,
  moderated_by TEXT,
  moderated_at INTEGER
);

CREATE TABLE presence(
  participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  stage_id TEXT,
  editing INTEGER NOT NULL DEFAULT 0,
  last_beat INTEGER NOT NULL
);

CREATE TABLE presentation_state(
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,
  show_summaries INTEGER NOT NULL DEFAULT 0,
  revealed_questions_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE proceed_overrides(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  missing_groups_json TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE publications(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK(source_type IN ('entry','submission','ai_output')),
  source_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  stage_id TEXT,
  group_id TEXT,
  snapshot_json TEXT NOT NULL,
  attachment_ids_json TEXT NOT NULL DEFAULT '[]',
  label_no INTEGER NOT NULL,
  label_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK(label_mode IN ('group','anonymous')),
  present INTEGER NOT NULL DEFAULT 0,
  published_by TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  unpublished_at INTEGER,
  UNIQUE(session_id, source_type, source_id),
  UNIQUE(session_id, label_no)
);

CREATE TABLE rate_limits(
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reactions(
  target_type TEXT NOT NULL CHECK(target_type IN ('entry','publication')),
  target_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(target_type, target_id, participant_id, type)
);

CREATE TABLE session_facilitators(
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','co')),
  added_by TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(session_id, user_id)
);

CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  joining_open INTEGER NOT NULL DEFAULT 1,
  early_join INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'setup' CHECK(status IN ('setup','live','archived')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  group_join_mode TEXT NOT NULL DEFAULT 'choose' CHECK(group_join_mode IN ('choose','assigned')),
  submit_policy TEXT NOT NULL DEFAULT 'any' CHECK(submit_policy IN ('any','representative')),
  participant_fields_json TEXT NOT NULL DEFAULT '[]',
  anonymise_default INTEGER NOT NULL DEFAULT 0,
  template TEXT NOT NULL DEFAULT 'blank',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  archived_at INTEGER
, reaction_config_json TEXT NOT NULL DEFAULT '{"enabled":true,"scope":"both","types":[{"key":"like","label":"Like"},{"key":"heart","label":"Heart"},{"key":"thumbs","label":"Thumbs up"}]}', critique_config_json TEXT NOT NULL DEFAULT '{"enabled":true,"scope":"both","requireApproval":false,"prompts":[{"key":"clarify","label":"Ask a clarifying question","enabled":true},{"key":"evidence","label":"Point to supporting evidence","enabled":true},{"key":"alternative","label":"Offer an alternative interpretation","enabled":true},{"key":"improve","label":"Suggest an improvement","enabled":true}]}', ai_criteria_json TEXT NOT NULL DEFAULT '{"preset":"general","purpose":"","criteria":"Themes, contrasting perspectives, unresolved questions, next steps","language":"English","detail":"standard"}');

CREATE TABLE stage_questions(
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0
, deleted_at INTEGER, visible INTEGER NOT NULL DEFAULT 1);

CREATE TABLE stage_resources(
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('link','file')),
  title TEXT NOT NULL,
  url TEXT,
  attachment_id TEXT
);

CREATE TABLE stages(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  visible INTEGER NOT NULL DEFAULT 1,
  availability TEXT NOT NULL DEFAULT 'locked' CHECK(availability IN ('locked','open','closed')),
  instructions TEXT NOT NULL DEFAULT '',
  contribution_types_json TEXT NOT NULL DEFAULT '["text","table","image"]',
  tags_json TEXT NOT NULL DEFAULT '[]', reference_stage_ids_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(session_id, position)
);

CREATE TABLE submissions(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  request_key TEXT,
  reopened_at INTEGER,
  reopened_by TEXT,
  reopen_note TEXT,
  UNIQUE(group_id, stage_id, revision)
);

CREATE TABLE users(
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_outputs_session ON ai_outputs(session_id, created_at);

CREATE UNIQUE INDEX idx_ai_usage_key ON ai_usage(user_id, request_key) WHERE request_key IS NOT NULL;

CREATE INDEX idx_ai_usage_user ON ai_usage(user_id, at);

CREATE INDEX idx_att_session ON attachments(session_id);

CREATE INDEX idx_audit_session ON audit_log(session_id, at);

CREATE INDEX idx_auth_participant ON auth_sessions(participant_id);

CREATE INDEX idx_auth_user ON auth_sessions(user_id);

CREATE INDEX idx_comments_target ON peer_comments(target_type, target_id);

CREATE UNIQUE INDEX idx_entries_clientkey ON entries(author_id, client_key) WHERE client_key IS NOT NULL;

CREATE INDEX idx_entries_gs ON entries(group_id, stage_id);

CREATE INDEX idx_groups_session ON groups(session_id);

CREATE INDEX idx_participants_group ON participants(group_id, status);

CREATE INDEX idx_participants_session ON participants(session_id);

CREATE INDEX idx_reactions_target ON reactions(target_type, target_id);

CREATE INDEX idx_res_stage ON stage_resources(stage_id);

CREATE INDEX idx_sf_user ON session_facilitators(user_id);

CREATE UNIQUE INDEX idx_sub_key ON submissions(group_id, stage_id, request_key) WHERE request_key IS NOT NULL;
