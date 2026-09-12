-- Curated notes have no user author; browser-authored subtitles remain attributed.
alter table agape.tv_subtitle_cue alter column user_id drop not null;
alter table agape.tv_subtitle_cue add column track text not null default 'community' check(track in ('community','notes'));
alter table agape.tv_subtitle_cue add constraint subtitle_author check(track='notes' or user_id is not null);
drop policy tv_cue_insert on agape.tv_subtitle_cue;
create policy tv_cue_insert on agape.tv_subtitle_cue for insert to authenticated
with check(track='community' and user_id=auth.uid() and exists(select 1 from agape.curated_tv_fragment f
where f.id=fragment_id and tv_subtitle_cue.start_seconds>=f.start_seconds and tv_subtitle_cue.end_seconds<=f.end_seconds));
create unique index curated_note_timing on agape.tv_subtitle_cue(fragment_id,locale,start_seconds) where track='notes';
