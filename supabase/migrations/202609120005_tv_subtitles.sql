-- Signed-in viewers can author their own timed overlays on curated TV excerpts.
create table agape.tv_subtitle_cue (
 id uuid primary key default gen_random_uuid(),
 fragment_id uuid not null references agape.curated_tv_fragment(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 locale text not null references agape.locale(locale),
 start_seconds numeric not null,
 end_seconds numeric not null check(end_seconds>start_seconds),
 markdown text not null check(length(trim(markdown)) between 1 and 2000)
);
create index on agape.tv_subtitle_cue(fragment_id,locale,start_seconds);
alter table agape.tv_subtitle_cue enable row level security;
grant select on agape.tv_subtitle_cue to anon,authenticated;
grant insert,delete on agape.tv_subtitle_cue to authenticated;
grant all on agape.tv_subtitle_cue to service_role;
create policy tv_cue_read on agape.tv_subtitle_cue for select to anon,authenticated
using(exists(select 1 from agape.curated_tv_fragment f where f.id=fragment_id));
create policy tv_cue_insert on agape.tv_subtitle_cue for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from agape.curated_tv_fragment f
where f.id=fragment_id and tv_subtitle_cue.start_seconds>=f.start_seconds and tv_subtitle_cue.end_seconds<=f.end_seconds));
create policy tv_cue_delete on agape.tv_subtitle_cue for delete to authenticated using(user_id=auth.uid());
