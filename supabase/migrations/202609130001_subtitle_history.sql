-- Append-only history for both curated and verified creator subtitle cues.
alter table agape.tv_subtitle_cue add column revision integer not null default 1;
alter table agape.subtitle_cues add column revision integer not null default 1;
create table agape.subtitle_history (
 id bigint generated always as identity primary key,
 source text not null check(source in ('curated','creator')),
 cue_id uuid not null,
 revision integer not null,
 operation text not null check(operation in ('baseline','insert','update','delete')),
 snapshot jsonb not null,
 editor uuid references auth.users(id) on delete set null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(source,cue_id,revision)
);
alter table agape.subtitle_history enable row level security;
revoke all on agape.subtitle_history from public,anon,authenticated;
insert into agape.subtitle_history(source,cue_id,revision,operation,snapshot)
select 'curated',id,revision,'baseline',to_jsonb(c) from agape.tv_subtitle_cue c;
insert into agape.subtitle_history(source,cue_id,revision,operation,snapshot)
select 'creator',id,revision,'baseline',to_jsonb(c) from agape.subtitle_cues c;

create function agape.record_subtitle_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_name text:=case when tg_table_name='tv_subtitle_cue' then 'curated' else 'creator' end;
  document jsonb; next_revision integer;
begin
 if tg_op='INSERT' then
  select coalesce(max(revision),0)+1 into next_revision from agape.subtitle_history where source=source_name and cue_id=new.id;
  new.revision:=next_revision;
  document:=to_jsonb(new);
 elsif tg_op='UPDATE' then
  new.revision:=old.revision+1; document:=to_jsonb(new); next_revision:=new.revision;
 else
  document:=to_jsonb(old); next_revision:=old.revision+1;
 end if;
 insert into agape.subtitle_history(source,cue_id,revision,operation,snapshot,editor)
 values(source_name,(document->>'id')::uuid,next_revision,lower(tg_op),document,auth.uid());
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger subtitle_history before insert or update or delete on agape.tv_subtitle_cue for each row execute function agape.record_subtitle_history();
create trigger subtitle_history before insert or update or delete on agape.subtitle_cues for each row execute function agape.record_subtitle_history();

create function agape.subtitle_history_list(p_source text,p_context text,p_track text,p_locale text)
returns setof agape.subtitle_history language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view revision history' using errcode='42501'; end if;
 if p_source='curated' then
  if not exists(select 1 from agape.curated_tv_fragment f join agape.ontology_node n using(node_id) where f.id::text=p_context and n.status='published') then raise exception 'Excerpt unavailable'; end if;
 elsif p_source='creator' then
  if not agape.owns_video(p_context) then raise exception 'Creator access required' using errcode='42501'; end if;
 else raise exception 'Unknown subtitle source'; end if;
 return query select h.* from agape.subtitle_history h
 where h.source=p_source and h.snapshot->>(case when p_source='curated' then 'fragment_id' else 'video_id' end)=p_context
 and h.snapshot->>'track'=p_track and h.snapshot->>'locale'=p_locale
 order by h.id desc limit 100;
end $$;

-- Optimistic concurrency: stale edits leave the current cue unchanged.
create function agape.save_subtitle(p_source text,p_id uuid,p_expected integer,p_start numeric,p_end numeric,p_markdown text,p_delete boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_source='curated' then
  if p_delete then delete from agape.tv_subtitle_cue where id=p_id and revision=p_expected;
  else update agape.tv_subtitle_cue set start_seconds=p_start,end_seconds=p_end,markdown=p_markdown,user_id=auth.uid(),updated_at=now() where id=p_id and revision=p_expected; end if;
 elsif p_source='creator' then
  if p_delete then delete from agape.subtitle_cues where id=p_id and revision=p_expected;
  else update agape.subtitle_cues set start_seconds=p_start,end_seconds=p_end,markdown=p_markdown where id=p_id and revision=p_expected; end if;
 else raise exception 'Unknown subtitle source'; end if;
 if not found then raise exception 'This subtitle changed or was removed. Your draft is kept; reload the latest version before saving.' using errcode='40001'; end if;
end $$;

create function agape.restore_subtitle(p_history bigint,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare h agape.subtitle_history; latest integer; doc jsonb; result_count integer;
begin
 if auth.uid() is null then raise exception 'Sign in to restore subtitles' using errcode='42501'; end if;
 select * into strict h from agape.subtitle_history where id=p_history;
 doc:=h.snapshot;
 -- Serialize competing restores, including restores of deleted cues.
 perform pg_advisory_xact_lock(hashtextextended(h.source||h.cue_id::text,0));
 if h.source='curated' then
  if not exists(select 1 from agape.curated_tv_fragment f join agape.ontology_node n using(node_id)
    where f.id=(doc->>'fragment_id')::uuid and n.status='published'
    and (doc->>'start_seconds')::numeric>=f.start_seconds and (doc->>'end_seconds')::numeric<=f.end_seconds) then raise exception 'Excerpt unavailable or timing no longer valid'; end if;
 else
  if not agape.owns_video(doc->>'video_id') then raise exception 'Creator access required' using errcode='42501'; end if;
 end if;
 select max(revision) into latest from agape.subtitle_history where source=h.source and cue_id=h.cue_id;
 if latest is distinct from p_expected then raise exception 'History changed. Refresh before restoring.' using errcode='40001'; end if;
 if h.source='curated' then
  update agape.tv_subtitle_cue set start_seconds=(doc->>'start_seconds')::numeric,end_seconds=(doc->>'end_seconds')::numeric,markdown=doc->>'markdown',user_id=auth.uid(),updated_at=now() where id=h.cue_id and revision=p_expected;
  if not found then
   if exists(select 1 from agape.tv_subtitle_cue where id=h.cue_id) then raise exception 'Subtitle changed. Refresh before restoring.' using errcode='40001'; end if;
   insert into agape.tv_subtitle_cue(id,fragment_id,user_id,locale,track,start_seconds,end_seconds,markdown)
   values(h.cue_id,(doc->>'fragment_id')::uuid,auth.uid(),doc->>'locale',doc->>'track',(doc->>'start_seconds')::numeric,(doc->>'end_seconds')::numeric,doc->>'markdown');
  end if;
 else
  update agape.subtitle_cues set start_seconds=(doc->>'start_seconds')::numeric,end_seconds=(doc->>'end_seconds')::numeric,markdown=doc->>'markdown' where id=h.cue_id and revision=p_expected;
  if not found then
   if exists(select 1 from agape.subtitle_cues where id=h.cue_id) then raise exception 'Subtitle changed. Refresh before restoring.' using errcode='40001'; end if;
   insert into agape.subtitle_cues(id,video_id,locale,track,start_seconds,end_seconds,markdown)
   values(h.cue_id,doc->>'video_id',doc->>'locale',doc->>'track',(doc->>'start_seconds')::numeric,(doc->>'end_seconds')::numeric,doc->>'markdown');
  end if;
 end if;
end $$;
revoke all on function agape.record_subtitle_history(),agape.subtitle_history_list(text,text,text,text),agape.save_subtitle(text,uuid,integer,numeric,numeric,text,boolean),agape.restore_subtitle(bigint,integer) from public,anon;
grant execute on function agape.subtitle_history_list(text,text,text,text),agape.save_subtitle(text,uuid,integer,numeric,numeric,text,boolean),agape.restore_subtitle(bigint,integer) to authenticated;
