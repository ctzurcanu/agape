-- Three shared subtitle alternatives, editable by signed-in Agape contributors.
alter table agape.tv_subtitle_cue drop constraint tv_subtitle_cue_track_check;
alter table agape.tv_subtitle_cue drop constraint subtitle_author;
drop index agape.curated_note_timing;
update agape.tv_subtitle_cue set track=case track when 'notes' then 'version1' else 'version2' end;
alter table agape.tv_subtitle_cue alter column track set default 'version1';
alter table agape.tv_subtitle_cue add constraint tv_subtitle_cue_track_check check(track in ('version1','version2','version3'));
alter table agape.tv_subtitle_cue add column updated_at timestamptz not null default now();
grant update(start_seconds,end_seconds,markdown,user_id,updated_at) on agape.tv_subtitle_cue to authenticated;
drop policy tv_cue_insert on agape.tv_subtitle_cue;
drop policy tv_cue_delete on agape.tv_subtitle_cue;
create policy tv_cue_insert on agape.tv_subtitle_cue for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from agape.curated_tv_fragment f where f.id=fragment_id
and tv_subtitle_cue.start_seconds>=f.start_seconds and tv_subtitle_cue.end_seconds<=f.end_seconds));
create policy tv_cue_update on agape.tv_subtitle_cue for update to authenticated
using(exists(select 1 from agape.curated_tv_fragment f where f.id=fragment_id))
with check(user_id=auth.uid() and exists(select 1 from agape.curated_tv_fragment f where f.id=fragment_id
and tv_subtitle_cue.start_seconds>=f.start_seconds and tv_subtitle_cue.end_seconds<=f.end_seconds));
create policy tv_cue_delete on agape.tv_subtitle_cue for delete to authenticated
using(exists(select 1 from agape.curated_tv_fragment f where f.id=fragment_id));
-- Preserve the previous notes as editable version 1; versions 2 and 3 begin blank.
alter table agape.subtitle_cues add column track text not null default 'version1' check(track in ('version1','version2','version3'));
grant update(start_seconds,end_seconds,markdown) on agape.subtitle_cues to authenticated;
create policy cues_update on agape.subtitle_cues for update to authenticated using(agape.owns_video(video_id)) with check(agape.owns_video(video_id));
