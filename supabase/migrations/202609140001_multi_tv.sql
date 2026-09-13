-- A topic can hold several named TVs. Each TV has one home topic and its own excerpt list,
-- subtitles, and editions; the topic's automatic loop stays separate and read-only.
do $$ begin
 if exists(select 1 from agape.tv_selection_order) or exists(select 1 from agape.tv_selection_timing)
  or exists(select 1 from agape.tv_selection_track) or exists(select 1 from agape.tv_selection_history) then
  raise exception 'Per-topic TV layouts or subtitles exist. Move them to named TVs before applying this migration.';
 end if;
end $$;

alter table agape.tv_program add column id uuid not null default gen_random_uuid(),
 add column node_id uuid references agape.ontology_node(node_id) on delete restrict,
 add column created_at timestamptz not null default now();
update agape.tv_program set node_id=nullif(selection_key,'root')::uuid;

create table agape.tv_program_item (
 program_id uuid not null,
 curated_fragment_id uuid references agape.curated_tv_fragment(id) on delete cascade,
 fragment_id uuid references agape.fragments(id) on delete cascade,
 section_id uuid generated always as (coalesce(curated_fragment_id,fragment_id)) stored,
 position integer not null,
 start_seconds numeric not null,
 end_seconds numeric not null,
 check(num_nonnulls(curated_fragment_id,fragment_id)=1),
 check(start_seconds>=0 and end_seconds>start_seconds),
 primary key(program_id,section_id)
);
-- Existing programs keep the excerpts and order they currently play.
insert into agape.tv_program_item(program_id,curated_fragment_id,fragment_id,position,start_seconds,end_seconds)
select p.id,
 case when coalesce((f->>'curated')::boolean,false) then (f->>'id')::uuid end,
 case when not coalesce((f->>'curated')::boolean,false) then (f->>'id')::uuid end,
 n,(f->>'start_seconds')::numeric,(f->>'end_seconds')::numeric
from agape.tv_program p cross join lateral jsonb_array_elements(agape.tv_browse(p.node_id,'en')->'fragments') with ordinality e(f,n);

alter table agape.tv_edition add column program_id uuid;
update agape.tv_edition e set program_id=p.id from agape.tv_program p where p.selection_key=e.selection_key;
drop policy edition_read on agape.tv_edition;
drop policy program_read on agape.tv_program;
alter table agape.tv_edition drop column selection_key;
alter table agape.tv_program drop constraint tv_program_pkey;
alter table agape.tv_program add primary key(id);
alter table agape.tv_program drop column selection_key;
alter table agape.tv_edition alter column program_id set not null,
 add foreign key(program_id) references agape.tv_program(id) on delete restrict;
alter table agape.tv_program_item add foreign key(program_id) references agape.tv_program(id) on delete cascade;
create index on agape.tv_program(node_id,created_at);
create index on agape.tv_edition(program_id,published_at desc);

drop function agape.can_edit_tv(uuid);
drop function agape.can_claim_tv(uuid);
drop function agape.claim_tv_program(uuid,text);
drop function agape.save_tv_order(uuid,integer,uuid[]);
drop function agape.trim_tv_section(uuid,uuid,integer,integer,integer,integer);
drop function agape.add_tv_section(uuid,text,text,text,integer,integer,integer);
drop function agape.save_tv_layout(uuid,jsonb,jsonb,text);
drop function agape.save_tv_track(uuid,text,text,integer,jsonb);
drop function agape.tv_edition_preview(uuid);
drop function agape.publish_tv_edition(uuid,text);
drop function agape.tv_edition_snapshot(uuid);
drop table agape.tv_selection_order, agape.tv_selection_timing, agape.tv_selection_track, agape.tv_selection_history;
-- The topic loop is the plain approved pool again.
drop function agape.tv_browse(uuid,text);
alter function agape.tv_browse_unordered(uuid,text) rename to tv_browse;
revoke all on function agape.tv_browse(uuid,text) from public;
grant execute on function agape.tv_browse(uuid,text) to anon,authenticated,service_role;

create table agape.tv_program_track (
 program_id uuid not null references agape.tv_program(id) on delete cascade,
 track text not null check(track in ('version1','version2','version3')),
 locale text not null references agape.locale(locale), revision integer not null,
 cues jsonb not null, primary key(program_id,track,locale)
);
create table agape.tv_program_history (
 id bigint generated always as identity primary key,
 program_id uuid not null references agape.tv_program(id) on delete cascade,
 track text not null, locale text not null, revision integer not null, cues jsonb not null,
 editor uuid references auth.users(id) on delete set null, recorded_at timestamptz not null default now(),
 unique(program_id,track,locale,revision)
);
alter table agape.tv_program_item enable row level security;
alter table agape.tv_program_track enable row level security;
alter table agape.tv_program_history enable row level security;
grant select on agape.tv_program_item,agape.tv_program_track to anon,authenticated;
grant select on agape.tv_program_history to authenticated;
create policy program_read on agape.tv_program for select to anon,authenticated
 using(node_id is null or exists(select 1 from agape.ontology_node n where n.node_id=tv_program.node_id and n.status='published'));
create policy item_read on agape.tv_program_item for select to anon,authenticated using(exists(select 1 from agape.tv_program p where p.id=program_id));
create policy track_read on agape.tv_program_track for select to anon,authenticated using(exists(select 1 from agape.tv_program p where p.id=program_id));
create policy history_read on agape.tv_program_history for select to authenticated using(exists(select 1 from agape.tv_program p where p.id=program_id));
create policy edition_read on agape.tv_edition for select to anon,authenticated using(exists(select 1 from agape.tv_program p where p.id=program_id));

-- Excerpts a TV at this home topic may include, with each source video's duration.
create function agape.tv_pool(p_node uuid) returns table(section_id uuid,curated boolean,duration numeric)
language sql stable security definer set search_path='' as $$
 select f.id,true,f.duration_seconds::numeric from agape.curated_tv_fragment f
 join agape.ontology_node n on n.node_id=f.node_id and n.status='published'
 where p_node is null or f.node_id in(select node_id from agape.descendants(p_node))
 union
 select f.id,false,v.duration_seconds::numeric from agape.fragments f join agape.videos v using(video_id)
 join agape.fragment_topics ft on ft.fragment_id=f.id and ft.status='approved'
 join agape.video_topics vt on vt.video_id=f.video_id and vt.node_id=ft.node_id and vt.status='approved'
 join agape.ontology_node n on n.node_id=ft.node_id and n.status='published'
 where p_node is null or ft.node_id in(select node_id from agape.descendants(p_node));
$$;
create function agape.tv_program_view(p_program uuid,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'program',jsonb_build_object('id',p.id,'title',p.title,'node_id',p.node_id,'owner_id',p.owner_id,'revision',p.revision),
  'node',(select to_jsonb(l) from agape.topic_labels l where l.node_id=p.node_id and l.locale=p_locale),
  'breadcrumbs',coalesce((
   with recursive up as (
    select n.node_id,n.parent_id,0 as depth from agape.ontology_node n where n.node_id=p.node_id
    union all
    select n.node_id,n.parent_id,up.depth+1 from agape.ontology_node n join up on n.node_id=up.parent_id
   ) select jsonb_agg(to_jsonb(l) order by up.depth desc) from up join agape.topic_labels l on l.node_id=up.node_id and l.locale=p_locale),'[]'::jsonb),
  'fragments',coalesce((
   select jsonb_agg(s.data||jsonb_build_object('start_seconds',i.start_seconds,'end_seconds',i.end_seconds) order by i.position)
   from agape.tv_program_item i cross join lateral (
    select to_jsonb(f)||jsonb_build_object('video_title',f.title,'curated',true) as data from agape.curated_tv_fragment f where f.id=i.curated_fragment_id
    union all
    select to_jsonb(f)||jsonb_build_object('video_title',v.title,'channel_title',c.title)
    from agape.fragments f join agape.videos v using(video_id) join agape.channels c using(channel_id) where f.id=i.fragment_id
   ) s where i.program_id=p.id),'[]'::jsonb))
 from agape.tv_program p where p.id=p_program;
$$;
create function agape.tv_programs(p_node uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'owner_id',p.owner_id,
  'sections',(select count(*) from agape.tv_program_item i where i.program_id=p.id),
  'latest_edition',(select jsonb_build_object('id',e.id,'published_at',e.published_at) from agape.tv_edition e where e.program_id=p.id order by e.published_at desc limit 1))
  order by p.created_at,p.id),'[]'::jsonb)
 from agape.tv_program p where p.node_id is not distinct from p_node;
$$;
create function agape.can_create_tv(p_node uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (agape.is_admin() or (p_node is not null and exists(
  select 1 from agape.videos v join agape.channels c using(channel_id)
  join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
  where c.user_id=auth.uid() and vt.status='approved'
   and v.verified_at>now()-interval '30 days' and c.verified_at>now()-interval '30 days')));
$$;
create function agape.can_edit_tv(p_program uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from agape.tv_program where id=p_program and (owner_id=auth.uid() or agape.is_admin()));
$$;
-- A new TV starts from the topic's current loop; its owner then removes, adds, and reorders.
create function agape.create_tv_program(p_node uuid,p_title text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not agape.can_create_tv(p_node) then raise exception 'Only a site administrator, or a creator with a verified video approved in this topic, can create a TV here.' using errcode='42501'; end if;
 insert into agape.tv_program(node_id,owner_id,title) values(p_node,auth.uid(),trim(p_title)) returning id into new_id;
 insert into agape.tv_program_item(program_id,curated_fragment_id,fragment_id,position,start_seconds,end_seconds)
 select new_id,case when s.curated then s.section_id end,case when not s.curated then s.section_id end,n,(f->>'start_seconds')::numeric,(f->>'end_seconds')::numeric
 from jsonb_array_elements(agape.tv_browse(p_node,'en')->'fragments') with ordinality e(f,n)
 join agape.tv_pool(p_node) s on s.section_id::text=f->>'id';
 return new_id;
end $$;
-- The entire sequence is replaced in one transaction; stale layouts cannot overwrite newer edits.
create function agape.save_tv_layout(p_program uuid,p_expected jsonb,p_sections jsonb,p_title text) returns integer
language plpgsql security definer set search_path='' as $$
declare program agape.tv_program; current_sections jsonb; rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-program:'||p_program::text,0));
 if not agape.can_edit_tv(p_program) then raise exception 'TV owner access required' using errcode='42501'; end if;
 select * into strict program from agape.tv_program where id=p_program;
 current_sections:=agape.tv_program_view(p_program,'en')->'fragments';
 if (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(current_sections) v) is distinct from
 (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(p_expected) v) then
  raise exception 'This TV changed elsewhere. Your draft is safe on this device; reload before retrying.' using errcode='40001'; end if;
 if p_sections is null or jsonb_typeof(p_sections)<>'array' or jsonb_array_length(p_sections)>200 then raise exception 'Use at most 200 video sections'; end if;
 if exists(select 1 from jsonb_array_elements(p_sections) v group by v->>'id' having count(*)>1) then raise exception 'Each video section can appear once in a TV'; end if;
 if exists(select 1 from jsonb_array_elements(p_sections) v left join agape.tv_pool(program.node_id) s on s.section_id::text=v->>'id'
  where s.section_id is null or jsonb_typeof(v->'start_seconds')<>'number' or jsonb_typeof(v->'end_seconds')<>'number'
   or (v->>'start_seconds')::numeric<0 or (v->>'end_seconds')::numeric<=(v->>'start_seconds')::numeric or (v->>'end_seconds')::numeric>s.duration) then
  raise exception 'Each section must come from this TV''s topic, with start and end within the original video'; end if;
 delete from agape.tv_program_item where program_id=p_program;
 insert into agape.tv_program_item(program_id,curated_fragment_id,fragment_id,position,start_seconds,end_seconds)
 select p_program,case when s.curated then s.section_id end,case when not s.curated then s.section_id end,n,(v->>'start_seconds')::numeric,(v->>'end_seconds')::numeric
 from jsonb_array_elements(p_sections) with ordinality e(v,n) join agape.tv_pool(program.node_id) s on s.section_id::text=v->>'id';
 update agape.tv_program set title=p_title,revision=revision+1 where id=p_program returning revision into rev;
 return rev;
end $$;
create function agape.add_tv_section(p_program uuid,p_node uuid,p_video text,p_title text,p_channel text,p_duration integer,p_start integer,p_end integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare program agape.tv_program; new_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-program:'||p_program::text,0));
 if not agape.can_edit_tv(p_program) then raise exception 'TV owner access required' using errcode='42501'; end if;
 select * into strict program from agape.tv_program where id=p_program;
 if not exists(select 1 from agape.ontology_node where node_id=p_node and status='published')
  or (program.node_id is not null and p_node not in(select node_id from agape.descendants(program.node_id))) then
  raise exception 'Choose a published topic within this TV''s topic'; end if;
 insert into agape.curated_tv_fragment(node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds,position)
 values(p_node,'manual',p_video,p_title,p_channel,p_duration,p_start,p_end,(select coalesce(max(position),0)+1 from agape.curated_tv_fragment)) returning id into new_id;
 insert into agape.tv_program_item(program_id,curated_fragment_id,position,start_seconds,end_seconds)
 values(p_program,new_id,(select coalesce(max(position),0)+1 from agape.tv_program_item where program_id=p_program),p_start,p_end);
 update agape.tv_program set revision=revision+1 where id=p_program;
 return new_id;
end $$;
create function agape.save_tv_track(p_program uuid,p_track text,p_locale text,p_expected integer,p_cues jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare current_revision integer; c jsonb; f jsonb; sections jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-program:'||p_program::text,0));
 if auth.uid() is null then raise exception 'Sign in to publish TV subtitles' using errcode='42501'; end if;
 if not exists(select 1 from agape.tv_program p where p.id=p_program and (p.node_id is null or exists(select 1 from agape.ontology_node n where n.node_id=p.node_id and n.status='published'))) then raise exception 'TV unavailable'; end if;
 if p_cues is null or jsonb_typeof(p_cues)<>'array' or jsonb_array_length(p_cues)>2000 then raise exception 'Use at most 2,000 subtitle cues'; end if;
 sections:=agape.tv_program_view(p_program,p_locale)->'fragments';
 for c in select value from jsonb_array_elements(p_cues) loop
  if jsonb_typeof(c)<>'object' or c->>'id' is null then raise exception 'Cue identifier required'; end if;
  perform (c->>'id')::uuid;
  select value into f from jsonb_array_elements(sections) where value->>'id'=c->>'section_id';
  if f is null or c->>'markdown' is null or length(trim(c->>'markdown')) not between 1 and 2000
   or c->>'start_seconds' is null or c->>'end_seconds' is null
   or not ((c->>'start_seconds')::numeric>=(f->>'start_seconds')::numeric and (c->>'end_seconds')::numeric<=(f->>'end_seconds')::numeric and (c->>'end_seconds')::numeric>(c->>'start_seconds')::numeric) then raise exception 'Invalid cue text, section, or timing'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_cues) as entries(value) group by entries.value->>'id' having count(*)>1) then raise exception 'Duplicate cue identifiers'; end if;
 select revision into current_revision from agape.tv_program_track where program_id=p_program and track=p_track and locale=p_locale;
 if coalesce(current_revision,0)<>p_expected then raise exception 'This TV subtitle version changed. Compare with the latest published subtitles.' using errcode='40001'; end if;
 current_revision:=coalesce(current_revision,0)+1;
 insert into agape.tv_program_track values(p_program,p_track,p_locale,current_revision,p_cues)
 on conflict(program_id,track,locale) do update set revision=excluded.revision,cues=excluded.cues;
 insert into agape.tv_program_history(program_id,track,locale,revision,cues,editor) values(p_program,p_track,p_locale,current_revision,p_cues,auth.uid());
 return current_revision;
end $$;
-- Deterministic edition content: every alternative and language, including source fallback captions.
-- Saved cues for sections no longer in the TV are left out.
create function agape.tv_edition_snapshot(p_program uuid) returns jsonb language sql stable set search_path='' as $$
 with program as (select * from agape.tv_program where id=p_program),
 sections as (select coalesce(agape.tv_program_view(p_program,'en')->'fragments','[]'::jsonb) v),
 section_ids as (select f->>'id' id from sections cross join lateral jsonb_array_elements(sections.v) f),
 source as (
  select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id') cue
  from sections cross join lateral jsonb_array_elements(sections.v) f join agape.tv_subtitle_cue s on s.fragment_id::text=f->>'id'
  union all
  select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id')
  from sections cross join lateral jsonb_array_elements(sections.v) f join agape.subtitle_cues s on s.video_id=f->>'video_id'
  where not coalesce((f->>'curated')::boolean,false)
 ),
 tracks as (
  select t.track,t.locale,coalesce((select jsonb_agg(c order by o) from jsonb_array_elements(t.cues) with ordinality x(c,o)
   where c->>'section_id' in(select id from section_ids)),'[]'::jsonb) cues
  from agape.tv_program_track t where t.program_id=p_program
  union all
  select c.track,c.locale,jsonb_agg(c.cue order by (c.cue->>'start_seconds')::numeric,c.cue->>'id') from source c
  where not exists(select 1 from agape.tv_program_track t where t.program_id=p_program and t.track=c.track and t.locale=c.locale)
  group by c.track,c.locale
 )
 select jsonb_build_object('title',program.title,'revision',program.revision,'fragments',sections.v,
  'tracks',(select coalesce(jsonb_agg(jsonb_build_object('track',track,'locale',locale,'cues',cues) order by track,locale),'[]') from tracks))
 from program cross join sections;
$$;
create function agape.tv_edition_preview(p_program uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snap jsonb;
begin
 if not agape.can_edit_tv(p_program) then raise exception 'TV owner access required' using errcode='42501'; end if;
 snap:=agape.tv_edition_snapshot(p_program);
 return jsonb_build_object('title',snap->'title','revision',snap->'revision',
  'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',f->'id','title',f->'title','start_seconds',f->'start_seconds','end_seconds',f->'end_seconds') order by n),'[]') from jsonb_array_elements(snap->'fragments') with ordinality e(f,n)),
  'tracks',(select coalesce(jsonb_agg(jsonb_build_object('track',t->'track','locale',t->'locale','cues',jsonb_array_length(t->'cues')) order by n),'[]') from jsonb_array_elements(snap->'tracks') with ordinality e(t,n)),
  'fingerprint',md5(snap::text));
end $$;
create function agape.publish_tv_edition(p_program uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare snap jsonb; edition_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-program:'||p_program::text,0));
 if not agape.can_edit_tv(p_program) then raise exception 'TV owner access required' using errcode='42501'; end if;
 snap:=agape.tv_edition_snapshot(p_program);
 if md5(snap::text) is distinct from p_fingerprint then raise exception 'This TV changed after you reviewed it. Review the edition again before publishing.' using errcode='40001'; end if;
 insert into agape.tv_edition(program_id,title,revision,fragments,tracks,published_by)
 values(p_program,snap->>'title',(snap->>'revision')::integer,snap->'fragments',snap->'tracks',auth.uid()) returning id into edition_id;
 return edition_id;
end $$;
revoke all on function agape.tv_pool(uuid),agape.tv_edition_snapshot(uuid) from public,anon,authenticated;
revoke all on function agape.tv_program_view(uuid,text),agape.tv_programs(uuid),agape.can_create_tv(uuid),agape.can_edit_tv(uuid),
 agape.create_tv_program(uuid,text),agape.save_tv_layout(uuid,jsonb,jsonb,text),agape.add_tv_section(uuid,uuid,text,text,text,integer,integer,integer),
 agape.save_tv_track(uuid,text,text,integer,jsonb),agape.tv_edition_preview(uuid),agape.publish_tv_edition(uuid,text) from public;
grant execute on function agape.tv_program_view(uuid,text),agape.tv_programs(uuid),agape.can_create_tv(uuid),agape.can_edit_tv(uuid) to anon,authenticated;
grant execute on function agape.create_tv_program(uuid,text),agape.save_tv_layout(uuid,jsonb,jsonb,text),agape.add_tv_section(uuid,uuid,text,text,text,integer,integer,integer),
 agape.save_tv_track(uuid,text,text,integer,jsonb),agape.tv_edition_preview(uuid),agape.publish_tv_edition(uuid,text) to authenticated;
notify pgrst,'reload schema';
