create table agape.verification_budget (
  user_id uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
alter table agape.verification_budget enable row level security;
revoke all on agape.verification_budget from public,anon,authenticated;
grant all on agape.verification_budget to service_role;

create function agape.consume_verification(p_user uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into agape.verification_budget(user_id) values(p_user)
  on conflict(user_id) do update set
    attempts=case when agape.verification_budget.window_start < now()-interval '1 hour' then 1 else agape.verification_budget.attempts+1 end,
    window_start=case when agape.verification_budget.window_start < now()-interval '1 hour' then now() else agape.verification_budget.window_start end
  returning attempts into n;
  return n<=10;
end $$;

create function agape.record_verified_video(p_user uuid,p_channel text,p_channel_title text,p_video text,
  p_title text,p_category text,p_duration integer,p_node uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from agape.ontology_node where node_id=p_node and status='published') then raise exception 'Topic not available'; end if;
  insert into agape.channels(channel_id,user_id,title,verified_at) values(p_channel,p_user,p_channel_title,now())
  on conflict(channel_id) do update set title=excluded.title,verified_at=now() where agape.channels.user_id=p_user;
  if not found then raise exception 'This channel is already connected to another account'; end if;
  insert into agape.videos(video_id,channel_id,title,youtube_category_id,duration_seconds,verified_at)
    values(p_video,p_channel,p_title,p_category,p_duration,now())
  on conflict(video_id) do update set title=excluded.title,youtube_category_id=excluded.youtube_category_id,
    duration_seconds=excluded.duration_seconds,verified_at=now() where agape.videos.channel_id=p_channel;
  if not found then raise exception 'Video ownership does not match'; end if;
  insert into agape.video_topics(video_id,node_id) values(p_video,p_node)
  on conflict(video_id,node_id) do update set status=case when agape.video_topics.status='approved' then 'approved' else 'pending' end;
end $$;
revoke all on function agape.consume_verification(uuid),agape.record_verified_video(uuid,text,text,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function agape.consume_verification(uuid),agape.record_verified_video(uuid,text,text,text,text,text,integer,uuid) to service_role;
