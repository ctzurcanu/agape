-- TV administration belongs to its creator, independently of site moderation.
create table agape.tv_program (
 selection_key text primary key, owner_id uuid not null references auth.users(id),
 title text not null check(length(trim(title)) between 1 and 160), revision integer not null default 0
);
create table agape.tv_edition (
 id uuid primary key default gen_random_uuid(), selection_key text not null references agape.tv_program,
 title text not null, revision integer not null, fragments jsonb not null, tracks jsonb not null,
 published_at timestamptz not null default now(), published_by uuid not null references auth.users(id)
);
alter table agape.tv_program enable row level security;
alter table agape.tv_edition enable row level security;
grant select on agape.tv_program,agape.tv_edition to anon,authenticated;
create policy program_read on agape.tv_program for select using(selection_key='root' or exists(select 1 from agape.ontology_node where node_id::text=selection_key and status='published'));
create policy edition_read on agape.tv_edition for select using(exists(select 1 from agape.tv_program p where p.selection_key=tv_edition.selection_key));
create function agape.can_edit_tv(p_node uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (agape.is_admin() or exists(select 1 from agape.tv_program where selection_key=coalesce(p_node::text,'root') and owner_id=auth.uid()));
$$;
revoke all on function agape.can_edit_tv(uuid) from public;
grant execute on function agape.can_edit_tv(uuid) to anon,authenticated;
create or replace function agape.save_tv_order(p_node uuid,p_expected integer,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare current_revision integer; available uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-order:'||coalesce(p_node::text,'root'),0));
 select coalesce(array_agg((v->>'id')::uuid),'{}') into available from jsonb_array_elements(agape.tv_browse(p_node,'en')->'fragments') v;
 if cardinality(p_ids) is distinct from cardinality(available) or not p_ids @> available or not available @> p_ids then raise exception 'The selection changed. Reload its sections before reordering.' using errcode='40001'; end if;
 select revision into current_revision from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root');
 if coalesce(current_revision,0)<>p_expected then raise exception 'The order changed. Reload before saving.' using errcode='40001'; end if;
 insert into agape.tv_selection_order values(coalesce(p_node::text,'root'),p_ids,coalesce(current_revision,0)+1)
 on conflict(selection_key) do update set section_ids=excluded.section_ids,revision=excluded.revision;
end $$;
create or replace function agape.add_tv_section(p_node uuid,p_video text,p_title text,p_channel text,p_duration integer,p_start integer,p_end integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 if not exists(select 1 from agape.ontology_node where node_id=p_node and status='published') then raise exception 'Choose a published Agape topic'; end if;
 insert into agape.curated_tv_fragment(node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds,position)
 values(p_node,'manual',p_video,p_title,p_channel,p_duration,p_start,p_end,(select coalesce(max(position),0)+1 from agape.curated_tv_fragment)) returning id into new_id;
 return new_id;
end $$;
create or replace function agape.trim_tv_section(p_node uuid,p_section uuid,p_expected_start integer,p_expected_end integer,p_start integer,p_end integer) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; duration integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-timing:'||coalesce(p_node::text,'root')||p_section::text,0));
 select value into f from jsonb_array_elements(agape.tv_browse(p_node,'en')->'fragments') where value->>'id'=p_section::text;
 if f is null then raise exception 'Section unavailable'; end if;
 if (f->>'start_seconds')::integer is distinct from p_expected_start or (f->>'end_seconds')::integer is distinct from p_expected_end then raise exception 'Section timing changed. Reopen the editor before trimming.' using errcode='40001'; end if;
 if coalesce((f->>'curated')::boolean,false) then select duration_seconds into duration from agape.curated_tv_fragment where id=p_section;
 else select v.duration_seconds into duration from agape.fragments s join agape.videos v using(video_id) where s.id=p_section; end if;
 if p_start is null or p_end is null or duration is null or p_start<0 or p_end<=p_start or p_end>duration then raise exception 'Start and end must be within the original video, with end after start'; end if;
 insert into agape.tv_selection_timing values(coalesce(p_node::text,'root'),p_section,p_start,p_end)
 on conflict(selection_key,section_id) do update set start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds;
end $$;
-- Entire sequence saved in one transaction; stale layouts cannot overwrite newer edits.
create function agape.save_tv_layout(p_node uuid,p_expected jsonb,p_sections jsonb,p_title text) returns integer
language plpgsql security definer set search_path='' as $$
declare current_sections jsonb; f jsonb; old jsonb; ids uuid[]; rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 current_sections:=agape.tv_browse(p_node,'en')->'fragments';
 if (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(current_sections) v) is distinct from
 (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(p_expected) v) then
 raise exception 'This TV changed elsewhere. Your draft is safe on this device; reload before retrying.' using errcode='40001'; end if;
 select array_agg((v->>'id')::uuid) into ids from jsonb_array_elements(p_sections) v;
 select coalesce(revision,0) into rev from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root');
 perform agape.save_tv_order(p_node,coalesce(rev,0),ids);
 for f in select value from jsonb_array_elements(p_sections) loop
 select value into old from jsonb_array_elements(current_sections) where value->>'id'=f->>'id';
 perform agape.trim_tv_section(p_node,(f->>'id')::uuid,(old->>'start_seconds')::integer,(old->>'end_seconds')::integer,(f->>'start_seconds')::integer,(f->>'end_seconds')::integer);
 end loop;
 update agape.tv_program set title=p_title,revision=revision+1 where selection_key=coalesce(p_node::text,'root') returning revision into rev;
 return rev;
end $$;
create function agape.publish_tv_edition(p_node uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare program agape.tv_program; edition_id uuid; sections jsonb; tracks jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 select * into strict program from agape.tv_program where selection_key=coalesce(p_node::text,'root');
 sections:=agape.tv_browse(p_node,'en')->'fragments';
 -- Preserve every alternative and language, including source fallback captions.
 select coalesce(jsonb_agg(jsonb_build_object('track',t.track,'locale',t.locale,'cues',t.cues)),'[]') into tracks from (
 select track,locale,cues from agape.tv_selection_track where selection_key=program.selection_key
 union all
 select c.track,c.locale,jsonb_agg(c.cue) from (
 select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id') cue
 from jsonb_array_elements(sections) f join agape.tv_subtitle_cue s on s.fragment_id::text=f->>'id'
 union all
 select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id') cue
 from jsonb_array_elements(sections) f join agape.subtitle_cues s on s.video_id=f->>'video_id' where not coalesce((f->>'curated')::boolean,false)
 ) c where not exists(select 1 from agape.tv_selection_track t where t.selection_key=program.selection_key and t.track=c.track and t.locale=c.locale) group by c.track,c.locale
 ) t;
 insert into agape.tv_edition(selection_key,title,revision,fragments,tracks,published_by) values(program.selection_key,program.title,program.revision,sections,tracks,auth.uid()) returning id into edition_id;
 return edition_id;
end $$;
revoke all on function agape.save_tv_layout(uuid,jsonb,jsonb,text),agape.publish_tv_edition(uuid) from public;
grant execute on function agape.save_tv_layout(uuid,jsonb,jsonb,text),agape.publish_tv_edition(uuid) to authenticated;
notify pgrst,'reload schema';
create or replace function agape.save_tv_track(p_node uuid,p_track text,p_locale text,p_expected integer,p_cues jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare current_revision integer; c jsonb; f jsonb; sections jsonb; key text:=coalesce(p_node::text,'root');
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
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
