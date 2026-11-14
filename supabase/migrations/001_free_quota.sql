-- Free prints: 3 per rolling 24 h, counted per IP and per device.
-- The clock is the database's now(); the visitor's device clock is never used.

create table if not exists free_quota (
  key text primary key,             -- 'ip:<sha256>' or 'dev:<uuid>'
  used int not null default 0,
  window_start timestamptz not null default now()
);

-- No policies: only the service role (the `print` edge function) can touch it.
alter table free_quota enable row level security;

create or replace function take_free_print(ip_key text, dev_key text, dry_run boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  free_per_window constant int := 3;
  win constant interval := interval '24 hours';
  worst int;
  reset_at timestamptz;
begin
  if not dry_run then
    insert into free_quota (key) values (ip_key), (dev_key) on conflict do nothing;
  end if;
  -- Lock both rows in a fixed order so two taps cannot both pass the check.
  perform 1 from free_quota where key in (ip_key, dev_key) order by key for update;
  update free_quota set used = 0
    where key in (ip_key, dev_key) and now() - window_start >= win;

  select coalesce(max(used), 0) into worst from free_quota where key in (ip_key, dev_key);

  if worst < free_per_window and not dry_run then
    -- The 24 h window starts at the first free print.
    update free_quota
      set window_start = case when used = 0 then now() else window_start end,
          used = used + 1
      where key in (ip_key, dev_key);
    worst := worst + 1;
  elsif worst >= free_per_window and not dry_run then
    worst := free_per_window + 1; -- marks "refused" below
  end if;

  select max(window_start + win) into reset_at
    from free_quota where key in (ip_key, dev_key) and used >= free_per_window;

  return json_build_object(
    'ok', worst <= free_per_window and (not dry_run or worst < free_per_window),
    'free', greatest(0, free_per_window - worst),
    'resetIn', case when reset_at is null then null else ceil(extract(epoch from reset_at - now())) end
  );
end;
$$;

revoke all on function take_free_print(text, text, boolean) from public, anon, authenticated;
