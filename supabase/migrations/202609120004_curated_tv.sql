-- Curated public embeds do not confer creator ownership or commenting eligibility.
create table agape.curated_tv_fragment (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references agape.ontology_node(node_id) on delete restrict,
  playlist_id text not null,
  video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check(length(title) between 1 and 160),
  channel_title text not null,
  duration_seconds integer not null check(duration_seconds > 0),
  start_seconds integer not null check(start_seconds >= 0),
  end_seconds integer not null,
  position integer not null default 0,
  check(end_seconds > start_seconds and end_seconds <= duration_seconds),
  unique(node_id,video_id,start_seconds,end_seconds)
);
alter table agape.curated_tv_fragment enable row level security;
grant select on agape.curated_tv_fragment to anon,authenticated;
grant all on agape.curated_tv_fragment to service_role;
create policy curated_tv_read on agape.curated_tv_fragment for select to anon,authenticated
using(exists(select 1 from agape.ontology_node n where n.node_id=curated_tv_fragment.node_id and n.status='published'));

create function agape.tv_browse(p_node uuid default null,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
with base as (select agape.browse(p_node,p_locale) as data), clips as (
 select to_jsonb(f)||jsonb_build_object('video_title',f.title,'curated',true) as data, f.position
 from agape.curated_tv_fragment f
 where p_node is null or f.node_id in(select node_id from agape.descendants(p_node))
 order by f.position,f.id limit 100
)
select jsonb_set(base.data,'{fragments}',
 coalesce((select jsonb_agg(data order by position) from clips),'[]'::jsonb) || (base.data->'fragments'))
from base;
$$;
revoke all on function agape.tv_browse(uuid,text) from public;
grant execute on function agape.tv_browse(uuid,text) to anon,authenticated,service_role;
