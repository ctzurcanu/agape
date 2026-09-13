-- Review decisions are recorded with reasons, and submitters can see where their submissions stand.
create table agape.moderation_decision (
 id bigint generated always as identity primary key,
 kind text not null check(kind in ('topic','video')),
 proposal_id uuid references agape.node_proposal(id) on delete cascade,
 video_id text references agape.videos(video_id) on delete cascade,
 node_id uuid references agape.ontology_node(node_id) on delete restrict,
 decision text not null check(decision in ('approved','rejected')),
 reason text check(reason is null or length(reason)<=1000),
 decided_by uuid references auth.users(id) on delete set null,
 decided_at timestamptz not null default now(),
 check((kind='topic' and proposal_id is not null and video_id is null)
  or (kind='video' and video_id is not null and node_id is not null and proposal_id is null)),
 check(decision='approved' or length(trim(coalesce(reason,'')))>0)
);
create index on agape.moderation_decision(video_id,node_id,decided_at desc);
create index on agape.moderation_decision(proposal_id,decided_at desc);
alter table agape.moderation_decision enable row level security;
revoke all on agape.moderation_decision from public,anon,authenticated;
-- Submitters may read decisions about their own work, but not who made them.
grant select(id,kind,proposal_id,video_id,node_id,decision,reason,decided_at) on agape.moderation_decision to authenticated;
create policy decision_read on agape.moderation_decision for select to authenticated using(
 agape.is_admin()
 or (kind='video' and agape.owns_video(video_id))
 or (kind='topic' and exists(select 1 from agape.node_proposal p where p.id=proposal_id and p.proposed_by=auth.uid())));

alter table agape.video_topics add column submitted_at timestamptz not null default now();
alter table agape.node_proposal add column created_node_id uuid references agape.ontology_node(node_id) on delete set null;

create or replace function agape.record_verified_video(p_user uuid,p_channel text,p_channel_title text,p_video text,
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
  -- Approved placements survive reverification; anything else re-enters the review queue.
  insert into agape.video_topics(video_id,node_id) values(p_video,p_node)
  on conflict(video_id,node_id) do update set
    status=case when agape.video_topics.status='approved' then 'approved' else 'pending' end,
    submitted_at=case when agape.video_topics.status='approved' then agape.video_topics.submitted_at else now() end;
end $$;

-- English topic path such as "Videos / Music / AI Music".
create function agape.topic_path(p_node uuid) returns text language sql stable set search_path='' as $$
 with recursive up as (
  select n.node_id,n.parent_id,0 as depth from agape.ontology_node n where n.node_id=p_node
  union all
  select n.node_id,n.parent_id,up.depth+1 from agape.ontology_node n join up on n.node_id=up.parent_id
 )
 select string_agg(coalesce(nn.name,n.slug),' / ' order by up.depth desc)
 from up join agape.ontology_node n using(node_id) left join agape.node_name nn on nn.node_id=up.node_id and nn.locale='en';
$$;

drop function agape.moderate(text,text,uuid,boolean);
create function agape.moderate(p_kind text,p_id text,p_node uuid,p_approve boolean,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare proposal agape.node_proposal; placement agape.video_topics; note text:=nullif(trim(coalesce(p_reason,'')),''); created uuid;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_approve is null then raise exception 'Choose approve or reject'; end if;
 if not p_approve and note is null then raise exception 'Give the submitter a reason for rejecting this submission.' using errcode='23514'; end if;
 if length(note)>1000 then raise exception 'Keep the reason under 1,000 characters.' using errcode='23514'; end if;
 if p_kind='topic' then
  select * into proposal from agape.node_proposal where id=p_id::uuid for update;
  if not found then raise exception 'Submission not found' using errcode='P0002'; end if;
  if proposal.status<>'pending' then raise exception 'Already reviewed. Refresh the review list.' using errcode='40001'; end if;
  if p_approve then created:=agape.create_topic(proposal.parent_id,proposal.name,proposal.description); end if;
  update agape.node_proposal set status=case when p_approve then 'approved' else 'rejected' end,created_node_id=created where id=proposal.id;
  insert into agape.moderation_decision(kind,proposal_id,node_id,decision,reason,decided_by)
  values('topic',proposal.id,created,case when p_approve then 'approved' else 'rejected' end,note,auth.uid());
 elsif p_kind='video' then
  select * into placement from agape.video_topics where video_id=p_id and node_id=p_node for update;
  if not found then raise exception 'Submission not found' using errcode='P0002'; end if;
  if placement.status<>'pending' then raise exception 'Already reviewed. Refresh the review list.' using errcode='40001'; end if;
  update agape.video_topics set status=case when p_approve then 'approved' else 'rejected' end where video_id=p_id and node_id=p_node;
  insert into agape.moderation_decision(kind,video_id,node_id,decision,reason,decided_by)
  values('video',p_id,p_node,case when p_approve then 'approved' else 'rejected' end,note,auth.uid());
 else raise exception 'Unknown submission type'; end if;
end $$;

drop function agape.moderation_queue();
create function agape.moderation_queue() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 return jsonb_build_object(
  'videos',coalesce((select jsonb_agg(jsonb_build_object(
    'video_id',vt.video_id,'node_id',vt.node_id,'title',v.title,'duration_seconds',v.duration_seconds,
    'channel_title',c.title,'submitted_at',vt.submitted_at,'topic',agape.topic_path(vt.node_id),
    'approved_placements',(select count(*) from agape.video_topics a join agape.videos av using(video_id) join agape.channels ac using(channel_id)
      where ac.user_id=c.user_id and a.status='approved'),
    'history',coalesce((select jsonb_agg(jsonb_build_object('decision',d.decision,'reason',d.reason,'decided_at',d.decided_at) order by d.decided_at desc,d.id desc)
      from agape.moderation_decision d where d.kind='video' and d.video_id=vt.video_id and d.node_id=vt.node_id),'[]'::jsonb))
   order by vt.submitted_at,vt.video_id)
   from agape.video_topics vt join agape.videos v using(video_id) join agape.channels c using(channel_id)
   where vt.status='pending'),'[]'::jsonb),
  'topics',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'description',p.description,'parent_id',p.parent_id,
    'parent',case when p.parent_id is null then null else agape.topic_path(p.parent_id) end,
    'proposer',coalesce((select ch.title from agape.channels ch where ch.user_id=p.proposed_by order by ch.verified_at desc limit 1),'Signed-in member'),
    'created_at',p.created_at)
   order by p.created_at,p.id)
   from agape.node_proposal p where p.status='pending'),'[]'::jsonb),
  'recent',coalesce((select jsonb_agg(jsonb_build_object(
    'kind',d.kind,'decision',d.decision,'reason',d.reason,'decided_at',d.decided_at,
    'subject',case when d.kind='video' then (select v.title from agape.videos v where v.video_id=d.video_id)
      else (select p.name from agape.node_proposal p where p.id=d.proposal_id) end,
    'topic',case when d.node_id is null then null else agape.topic_path(d.node_id) end,
    'decided_by',(select u.email from auth.users u where u.id=d.decided_by))
   order by d.decided_at desc,d.id desc)
   from (select * from agape.moderation_decision order by decided_at desc,id desc limit 50) d),'[]'::jsonb));
end $$;

create function agape.my_submissions() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'placements',coalesce((select jsonb_agg(jsonb_build_object(
    'video_id',v.video_id,'title',v.title,'node_id',vt.node_id,'topic',agape.topic_path(vt.node_id),
    'status',vt.status,'submitted_at',vt.submitted_at,'decided_at',d.decided_at,'reason',d.reason)
   order by vt.submitted_at desc,v.video_id)
   from agape.video_topics vt join agape.videos v using(video_id) join agape.channels c using(channel_id)
   left join lateral (select x.decided_at,x.reason from agape.moderation_decision x
    where x.kind='video' and x.video_id=vt.video_id and x.node_id=vt.node_id order by x.decided_at desc,x.id desc limit 1) d on true
   where c.user_id=auth.uid()),'[]'::jsonb),
  'topics',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'parent',case when p.parent_id is null then null else agape.topic_path(p.parent_id) end,
    'status',p.status,'created_at',p.created_at,'created_node_id',p.created_node_id,'decided_at',d.decided_at,'reason',d.reason)
   order by p.created_at desc,p.id)
   from agape.node_proposal p
   left join lateral (select x.decided_at,x.reason from agape.moderation_decision x
    where x.kind='topic' and x.proposal_id=p.id order by x.decided_at desc,x.id desc limit 1) d on true
   where p.proposed_by=auth.uid()),'[]'::jsonb));
$$;

revoke all on function agape.topic_path(uuid),agape.moderate(text,text,uuid,boolean,text),agape.moderation_queue(),agape.my_submissions() from public,anon;
grant execute on function agape.topic_path(uuid),agape.moderate(text,text,uuid,boolean,text),agape.moderation_queue(),agape.my_submissions() to authenticated;
notify pgrst,'reload schema';
