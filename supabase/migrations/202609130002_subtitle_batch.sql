-- A publish is atomic: a conflicting cue rolls back every edit in the batch.
create function agape.publish_subtitles(p_source text,p_context text,p_track text,p_locale text,p_changes jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to publish subtitles' using errcode='42501'; end if;
 if p_source not in ('curated','creator') or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>1000 then raise exception 'Invalid subtitle batch'; end if;
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'operation'='insert' then
   if p_source='curated' then
    insert into agape.tv_subtitle_cue(id,fragment_id,locale,track,start_seconds,end_seconds,markdown)
    values((c->>'id')::uuid,p_context::uuid,p_locale,p_track,(c->>'start_seconds')::numeric,(c->>'end_seconds')::numeric,c->>'markdown');
   else
    insert into agape.subtitle_cues(id,video_id,locale,track,start_seconds,end_seconds,markdown)
    values((c->>'id')::uuid,p_context,p_locale,p_track,(c->>'start_seconds')::numeric,(c->>'end_seconds')::numeric,c->>'markdown');
   end if;
  elsif c->>'operation' in ('update','delete') then
   if p_source='curated' then
    if not exists(select 1 from agape.tv_subtitle_cue where id=(c->>'id')::uuid and fragment_id=p_context::uuid and track=p_track and locale=p_locale) then raise exception 'Subtitle changed or unavailable' using errcode='40001'; end if;
   else
    if not exists(select 1 from agape.subtitle_cues where id=(c->>'id')::uuid and video_id=p_context and track=p_track and locale=p_locale) then raise exception 'Subtitle changed or unavailable' using errcode='40001'; end if;
   end if;
   perform agape.save_subtitle(p_source,(c->>'id')::uuid,(c->>'expected')::integer,(c->>'start_seconds')::numeric,(c->>'end_seconds')::numeric,c->>'markdown',c->>'operation'='delete');
  else raise exception 'Unknown subtitle operation'; end if;
 end loop;
end $$;
revoke all on function agape.publish_subtitles(text,text,text,text,jsonb) from public,anon;
grant execute on function agape.publish_subtitles(text,text,text,text,jsonb) to authenticated;
