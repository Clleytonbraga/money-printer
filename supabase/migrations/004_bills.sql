-- Every bill ever printed, by everyone. The id is the bill number and the
-- global count. Visitors read the room through list_bills(); the device
-- column never leaves the server (it is the key to the paid balance).

create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  device text not null,
  name text not null default '' check (length(name) <= 40),
  text text not null default '' check (length(text) <= 140),
  link text not null default '' check (length(link) <= 200),
  photo text, -- path in the public `photos` bucket
  zoom real not null default 1.4,
  pan_x real not null default 0,
  pan_y real not null default 0,
  created_at timestamptz not null default now()
);
alter table owners enable row level security; -- no policies: service role only

create table if not exists bills (
  id bigserial primary key,
  gold boolean not null,
  owner uuid references owners,
  animal smallint, -- portrait of the house bills (index into CONFIG.pile.animals)
  x real, z real, yaw real, -- where it came to rest; null until the printer's page reports it
  device text,
  created_at timestamptz not null default now()
);
alter table bills enable row level security;

-- The house bills: the 500 the room starts with, laid out like World.seedPile did.
insert into bills (gold, animal, x, z, yaw)
select random() < 0.15, floor(random() * 16)::smallint,
       ((random() + random() + random() - 1.5) / 1.5) * 0.65,
       0.825 + ((random() + random() + random() - 1.5) / 1.5) * 0.4,
       random() * 2 * pi()
from generate_series(1, 500)
where not exists (select 1 from bills);

-- One value, not rows: PostgREST caps row results at 1000.
-- ponytail: sends every bill (~30 bytes each); page by area or age past ~100k bills.
create or replace function list_bills()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bills', coalesce((select jsonb_agg(jsonb_build_array(
        id, gold, round(x::numeric, 3), round(z::numeric, 3), round(yaw::numeric, 2), animal, owner) order by id)
      from bills), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'text', text, 'link', link, 'photo', photo,
        'zoom', zoom, 'panX', pan_x, 'panY', pan_y))
      from owners), '[]'::jsonb));
$$;
revoke all on function list_bills() from public;
grant execute on function list_bills() to anon, authenticated;

insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do nothing;
