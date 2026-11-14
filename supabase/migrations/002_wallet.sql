-- Paid ink balance. There is no login: the balance belongs to the device id
-- the site keeps in the browser. (Not the IP: people behind one router share
-- an IP, and a phone changes IP when it leaves the Wi-Fi.)

create table if not exists wallet (
  device text primary key,
  paid int not null default 0 check (paid >= 0),
  updated_at timestamptz not null default now()
);
alter table wallet enable row level security; -- no policies: service role only

-- delta > 0 credits a purchase, delta = -1 spends one print, delta = 0 reads.
-- Returns the new balance, or null when there is not enough ink to spend.
create or replace function wallet_change(dev text, delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  bal int;
begin
  if delta > 0 then
    insert into wallet (device, paid) values (dev, delta)
      on conflict (device) do update set paid = wallet.paid + delta, updated_at = now()
      returning paid into bal;
  elsif delta < 0 then
    update wallet set paid = paid + delta, updated_at = now()
      where device = dev and paid + delta >= 0
      returning paid into bal;
  else
    select coalesce((select paid from wallet where device = dev), 0) into bal;
  end if;
  return bal;
end;
$$;

revoke all on function wallet_change(text, int) from public, anon, authenticated;
