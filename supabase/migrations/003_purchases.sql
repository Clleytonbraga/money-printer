-- One row per paid Stripe Checkout session. The primary key makes crediting
-- idempotent: the webhook and the "I am back from Stripe" confirmation can
-- both report the same session, and the ink is added once.

create table if not exists purchases (
  session_id text primary key,
  device text not null,
  pack text not null,
  prints int not null,
  created_at timestamptz not null default now()
);
alter table purchases enable row level security; -- no policies: service role only

-- Returns the device's paid balance after the purchase is recorded.
create or replace function credit_purchase(session text, dev text, pack_name text, n int)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into purchases (session_id, device, pack, prints) values (session, dev, pack_name, n)
    on conflict (session_id) do nothing;
  if not found then
    return wallet_change(dev, 0); -- already credited
  end if;
  return wallet_change(dev, n);
end;
$$;

revoke all on function credit_purchase(text, text, text, int) from public, anon, authenticated;
