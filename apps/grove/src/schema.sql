CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  credential_hash text NOT NULL UNIQUE,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS host_devices (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  credential_hash text NOT NULL UNIQUE,
  disabled_at bigint,
  created_at bigint NOT NULL,
  UNIQUE (id, owner_user_id)
);
CREATE TABLE IF NOT EXISTS network_bots (
  network_id text PRIMARY KEY,
  local_bot_id text NOT NULL,
  owner_user_id text NOT NULL REFERENCES users(id),
  host_id text NOT NULL,
  name text NOT NULL,
  FOREIGN KEY (host_id, owner_user_id) REFERENCES host_devices(id, owner_user_id),
  UNIQUE (host_id, local_bot_id)
);
CREATE TABLE IF NOT EXISTS relationships (
  id text PRIMARY KEY,
  requester_user_id text NOT NULL REFERENCES users(id),
  recipient_user_id text NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'revoked')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (requester_user_id <> recipient_user_id)
);
CREATE TABLE IF NOT EXISTS social_grants (
  id text PRIMARY KEY,
  issuer_user_id text NOT NULL REFERENCES users(id),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'bot')),
  subject_id text NOT NULL,
  target_bot_id text NOT NULL REFERENCES network_bots(network_id),
  definition jsonb NOT NULL,
  revoked_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS social_grants_target_subject ON social_grants (target_bot_id, subject_type, subject_id);
CREATE TABLE IF NOT EXISTS network_operations (
  id text PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'bot')),
  subject_id text NOT NULL,
  target_bot_id text NOT NULL REFERENCES network_bots(network_id),
  action text NOT NULL CHECK (action IN ('message.send', 'task.request', 'tool.propose', 'tool.install', 'tool.invoke')),
  grant_id text REFERENCES social_grants(id),
  fingerprint text NOT NULL,
  tool_id text,
  mcp_server_id text,
  state text NOT NULL CHECK (state IN ('pending', 'awaiting_approval', 'installing', 'completed', 'failed', 'rejected')),
  error text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS network_operations_grant ON network_operations (grant_id);
CREATE TABLE IF NOT EXISTS network_messages (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES network_operations(id),
  source_host_id text NOT NULL REFERENCES host_devices(id),
  recipient_host_id text NOT NULL REFERENCES host_devices(id),
  from_bot_id text NOT NULL REFERENCES network_bots(network_id),
  to_bot_id text NOT NULL REFERENCES network_bots(network_id),
  type text NOT NULL CHECK (type IN ('message', 'task', 'result')),
  payload jsonb NOT NULL,
  created_at bigint NOT NULL,
  received_at bigint
);
CREATE INDEX IF NOT EXISTS network_messages_pending ON network_messages (recipient_host_id, created_at) WHERE received_at IS NULL;
ALTER TABLE network_bots ADD COLUMN IF NOT EXISTS shared_mcp jsonb NOT NULL DEFAULT '[]';
ALTER TABLE network_operations ADD COLUMN IF NOT EXISTS capability jsonb;
