-- Creators can remove their Agape data themselves. The Supabase sign-in account is shared with
-- Allways, so it is never deleted here: only rows in the agape schema are deleted or anonymized.
alter table agape.tv_edition alter column published_by drop not null;

create function agape.delete_my_agape_data(p_confirm text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); counts jsonb:='{}'::jsonb; n integer; my_videos text[];
begin
 if me is null then raise exception 'Sign in to delete your Agape data' using errcode='42501'; end if;
 if p_confirm is distinct from 'DELETE MY AGAPE DATA' then raise exception 'Type DELETE MY AGAPE DATA to confirm.' using errcode='22023'; end if;
 -- Two administrators deleting at once must not leave Agape without one.
 perform pg_advisory_xact_lock(hashtextextended('agape-administrators',0));
 if exists(select 1 from agape.members where user_id=me and role='admin')
  and not exists(select 1 from agape.members where role='admin' and user_id<>me) then
  raise exception 'You are the only Agape administrator. Assign another administrator first.' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ballot-voter:'||me::text,0));

 delete from agape.ballot_vote where voter_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('votes',n);
 delete from agape.tv_edition where program_id in(select id from agape.tv_program where owner_id=me);
 delete from agape.tv_program where owner_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('tvs',n);
 delete from agape.comments where user_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('comments',n);
 -- Channels cascade to videos, placements, moments, creator subtitles, comments on those videos,
 -- their ballot entries and review decisions.
 select coalesce(array_agg(v.video_id),'{}') into my_videos from agape.videos v join agape.channels c using(channel_id) where c.user_id=me;
 counts:=counts||jsonb_build_object('videos',cardinality(my_videos));
 delete from agape.channels where user_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('channels',n);
 delete from agape.subtitle_history where source='creator' and snapshot->>'video_id'=any(my_videos);
 delete from agape.node_proposal where proposed_by=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('topic_suggestions',n);
 delete from agape.voting_fine where user_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('fines',n);
 delete from agape.verification_budget where user_id=me;
 delete from agape.members where user_id=me;

 -- Shared work stays, without the author. Cues first: their history trigger records the change.
 update agape.tv_subtitle_cue set user_id=null where user_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('anonymized_subtitles',n);
 update agape.subtitle_history set editor=null where editor=me;
 update agape.tv_program_history set editor=null where editor=me;
 update agape.tv_edition set published_by=null where published_by=me;
 update agape.moderation_decision set decided_by=null where decided_by=me;
 update agape.voting_fine set imposed_by=null where imposed_by=me;
 update agape.voting_fine set revoked_by=null where revoked_by=me;
 update agape.ballot set created_by=null where created_by=me;
 update agape.ballot_entry set owner_id=null where owner_id=me;
 update agape.voting_budget_config set created_by=null where created_by=me;
 return counts;
end $$;
revoke all on function agape.delete_my_agape_data(text) from public,anon;
grant execute on function agape.delete_my_agape_data(text) to authenticated;
notify pgrst,'reload schema';
