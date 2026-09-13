-- Selection-specific ordering and subtitle editions. Source tracks stay independent.
create table agape.tv_selection_order (
 selection_key text primary key, section_ids uuid[] not null, revision integer not null default 1
);
create table agape.tv_selection_track (
 selection_key text not null, track text not null check(track in ('version1','version2','version3')),
 locale text not null references agape.locale(locale), revision integer not null,
 cues jsonb not null, primary key(selection_key,track,locale)
);
create table agape.tv_selection_history (
 id bigint generated always as identity primary key, selection_key text not null,
 track text not null, locale text not null, revision integer not null, cues jsonb not null,
 editor uuid references auth.users(id) on delete set null, recorded_at timestamptz not null default now(),
 unique(selection_key,track,locale,revision)
);
alter table agape.tv_selection_order enable row level security;
alter table agape.tv_selection_track enable row level security;
alter table agape.tv_selection_history enable row level security;
grant select on agape.tv_selection_order,agape.tv_selection_track to anon,authenticated;
grant select on agape.tv_selection_history to authenticated;
create policy selection_order_read on agape.tv_selection_order for select to anon,authenticated using(selection_key='root' or exists(select 1 from agape.ontology_node n where n.node_id::text=selection_key and n.status='published'));
create policy selection_track_read on agape.tv_selection_track for select to anon,authenticated using(selection_key='root' or exists(select 1 from agape.ontology_node n where n.node_id::text=selection_key and n.status='published'));
create policy selection_history_read on agape.tv_selection_history for select to authenticated using(selection_key='root' or exists(select 1 from agape.ontology_node n where n.node_id::text=selection_key and n.status='published'));

alter function agape.tv_browse(uuid,text) rename to tv_browse_unordered;
create function agape.tv_browse(p_node uuid default null,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
with base as (select agape.tv_browse_unordered(p_node,p_locale) data), layout as (
 select section_ids from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root')
)
select jsonb_set(data,'{fragments}',coalesce((select jsonb_agg(f.value order by coalesce(array_position((select section_ids from layout),(f.value->>'id')::uuid),2147483647),f.ordinality) from jsonb_array_elements(data->'fragments') with ordinality f),'[]'::jsonb)) from base;
$$;
create function agape.save_tv_order(p_node uuid,p_expected integer,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer; available uuid[];
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-order:'||coalesce(p_node::text,'root'),0));
 select coalesce(array_agg((v->>'id')::uuid),'{}') into available from jsonb_array_elements(agape.tv_browse(p_node,'en')->'fragments') v;
 if cardinality(p_ids) is distinct from cardinality(available) or not p_ids @> available or not available @> p_ids then raise exception 'The selection changed. Reload its sections before reordering.' using errcode='40001'; end if;
 select revision into current_revision from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root');
 if coalesce(current_revision,0)<>p_expected then raise exception 'The order changed. Reload before saving.' using errcode='40001'; end if;
 insert into agape.tv_selection_order values(coalesce(p_node::text,'root'),p_ids,coalesce(current_revision,0)+1)
 on conflict(selection_key) do update set section_ids=excluded.section_ids,revision=excluded.revision;
end $$;
create function agape.add_tv_section(p_node uuid,p_video text,p_title text,p_channel text,p_duration integer,p_start integer,p_end integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if not exists(select 1 from agape.ontology_node where node_id=p_node and status='published') then raise exception 'Choose a published Agape topic'; end if;
 insert into agape.curated_tv_fragment(node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds,position)
 values(p_node,'manual',p_video,p_title,p_channel,p_duration,p_start,p_end,(select coalesce(max(position),0)+1 from agape.curated_tv_fragment)) returning id into new_id;
 return new_id;
end $$;
create function agape.save_tv_track(p_node uuid,p_track text,p_locale text,p_expected integer,p_cues jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare current_revision integer; c jsonb; f jsonb; sections jsonb; key text:=coalesce(p_node::text,'root');
begin
 if auth.uid() is null then raise exception 'Sign in to publish TV subtitles' using errcode='42501'; end if;
 if p_node is not null and not exists(select 1 from agape.ontology_node where node_id=p_node and status='published') then raise exception 'Selection unavailable'; end if;
 if p_cues is null or jsonb_typeof(p_cues)<>'array' or jsonb_array_length(p_cues)>2000 then raise exception 'Use at most 2,000 subtitle cues'; end if;
 sections:=agape.tv_browse(p_node,p_locale)->'fragments';
 for c in select value from jsonb_array_elements(p_cues) loop
  if jsonb_typeof(c)<>'object' or c->>'id' is null then raise exception 'Cue identifier required'; end if;
  perform (c->>'id')::uuid;
  select value into f from jsonb_array_elements(sections) where value->>'id'=c->>'section_id';
  if f is null or c->>'markdown' is null or length(trim(c->>'markdown')) not between 1 and 2000
   or c->>'start_seconds' is null or c->>'end_seconds' is null
   or not ((c->>'start_seconds')::numeric >= (f->>'start_seconds')::numeric and (c->>'end_seconds')::numeric <= (f->>'end_seconds')::numeric and (c->>'end_seconds')::numeric > (c->>'start_seconds')::numeric) then raise exception 'Invalid cue text, section, or timing'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_cues) as entries(value) group by entries.value->>'id' having count(*)>1) then raise exception 'Duplicate cue identifiers'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-track:'||key||p_track||p_locale,0));
 select revision into current_revision from agape.tv_selection_track where selection_key=key and track=p_track and locale=p_locale;
 if coalesce(current_revision,0)<>p_expected then raise exception 'This TV subtitle version changed. Compare with the latest published subtitles.' using errcode='40001'; end if;
 current_revision:=coalesce(current_revision,0)+1;
 insert into agape.tv_selection_track values(key,p_track,p_locale,current_revision,p_cues)
 on conflict(selection_key,track,locale) do update set revision=excluded.revision,cues=excluded.cues;
 insert into agape.tv_selection_history(selection_key,track,locale,revision,cues,editor) values(key,p_track,p_locale,current_revision,p_cues,auth.uid());
 return current_revision;
end $$;
revoke all on function agape.tv_browse(uuid,text),agape.save_tv_order(uuid,integer,uuid[]),agape.add_tv_section(uuid,text,text,text,integer,integer,integer),agape.save_tv_track(uuid,text,text,integer,jsonb) from public;
grant execute on function agape.tv_browse(uuid,text) to anon,authenticated,service_role;
grant execute on function agape.save_tv_order(uuid,integer,uuid[]),agape.add_tv_section(uuid,text,text,text,integer,integer,integer),agape.save_tv_track(uuid,text,text,integer,jsonb) to authenticated;
