import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: databaseUrl });

const sql = `
create extension if not exists pgcrypto;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists processed_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox text not null,
  uid_validity text,
  uid bigint,
  message_id text,
  subject text,
  sender text,
  received_at timestamptz,
  processed_at timestamptz not null default now(),
  status text not null,
  error text,
  unique (mailbox, uid_validity, uid),
  unique (message_id)
);

create table if not exists review_subjects (
  id uuid primary key default gen_random_uuid(),
  merchant text not null,
  external_id text,
  canonical_url text,
  normalized_key text not null,
  title text not null,
  brand text,
  image_url text,
  product_snapshot jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_purchased_at timestamptz not null default now(),
  reviewed_at timestamptz,
  final_rating int,
  final_review text,
  unique (merchant, normalized_key)
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  review_subject_id uuid not null references review_subjects(id) on delete cascade,
  merchant text not null,
  order_id text,
  product_title text not null,
  product_url text,
  image_url text,
  price numeric(12,2),
  currency text,
  quantity int not null default 1,
  purchased_at timestamptz,
  delivered_at timestamptz,
  source text not null,
  source_message_id uuid references processed_messages(id) on delete set null,
  raw_extract jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists review_tasks (
  id uuid primary key default gen_random_uuid(),
  review_subject_id uuid not null references review_subjects(id) on delete cascade,
  status text not null default 'pending',
  due_at timestamptz not null,
  delay_days int not null,
  category text not null,
  category_confidence numeric(4,3) not null default 0,
  user_blurb text,
  rating int,
  generated_draft text,
  approved_review text,
  approved_at timestamptz,
  last_notified_at timestamptz,
  reminder_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists review_tasks_one_open_per_subject
on review_tasks(review_subject_id)
where status in ('pending', 'due', 'snoozed', 'drafted');

create table if not exists notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  review_task_id uuid references review_tasks(id) on delete cascade,
  channel text not null,
  status text not null,
  error text,
  delivered_at timestamptz not null default now()
);

create table if not exists parser_events (
  id uuid primary key default gen_random_uuid(),
  processed_message_id uuid references processed_messages(id) on delete cascade,
  level text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into app_settings(key, value) values
  ('notifications', '{"pushEnabled": true, "emailEnabled": false, "emailFallbackEnabled": false, "digestMode": "off", "quietHoursStart": "22:00", "quietHoursEnd": "08:00", "maxRemindersPerItem": 3, "reminderIntervalDays": 3, "defaultSnoozeDays": 7}'::jsonb),
  ('privacy', '{"llmReceiptFallback": "off", "sendOrderIdsToLlm": false, "sendEmailMetadataToLlm": false}'::jsonb),
  ('reviewTiming', '{"defaultDelayDays": 14}'::jsonb),
  ('imap', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;
`;

async function main() {
  await pool.query(sql);
  await pool.end();
  console.log("Database migration complete");
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
