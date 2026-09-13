-- Random discovery slots for fair exposure, and public creator profiles.
create function agape.discover_videos(p_node uuid default null,p_limit integer default 3) returns jsonb
language sql volatile security definer set search_path='' as $$
 with pool as (
  select distinct v.video_id,v.channel_id,v.title,c.title as channel_title,v.duration_seconds,c.user_id
  from agape.videos v join agape.channels c using(channel_id)
  join agape.video_topics vt using(video_id)
  join agape.ontology_node n on n.node_id=vt.node_id and n.status='published'
  where vt.status='approved' and (p_node is null or vt.node_id in(select node_id from agape.descendants(p_node)))
 ), scored as (
  -- Works already recommended on a closed ballot have had exposure; others come first.
  select p.*,exists(select 1 from agape.ballot_entry e join agape.ballot b on b.id=e.ballot_id
    join agape.ballot_vote bv on bv.entry_id=e.id
    where e.video_id=p.video_id and clock_timestamp()>=b.closes_at) as recognized,random() as luck
  from pool p
 ), one_per_creator as (
  select distinct on (user_id) * from scored order by user_id,recognized,luck
 )
 select coalesce(jsonb_agg(jsonb_build_object('video_id',s.video_id,'channel_id',s.channel_id,'title',s.title,
  'channel_title',s.channel_title,'duration_seconds',s.duration_seconds) order by s.recognized,s.luck),'[]'::jsonb)
 from (select * from one_per_creator order by recognized,luck limit least(greatest(coalesce(p_limit,3),1),6)) s;
$$;

-- A profile exists only while the creator has an approved placement; it never exposes sign-in data.
create function agape.creator_profile(p_user uuid,p_locale text default 'en') returns jsonb
language sql stable security definer set search_path='' as $$
 with approved as (
  select vt.video_id,vt.node_id from agape.video_topics vt join agape.videos v using(video_id)
  join agape.channels c using(channel_id) join agape.ontology_node n on n.node_id=vt.node_id and n.status='published'
  where c.user_id=p_user and vt.status='approved'
 )
 select case when not exists(select 1 from approved) then null else jsonb_build_object(
  'user_id',p_user,
  'channels',coalesce((select jsonb_agg(jsonb_build_object('channel_id',c.channel_id,'title',c.title,'verified_at',c.verified_at) order by c.title)
   from agape.channels c where c.user_id=p_user
    and exists(select 1 from agape.videos v join approved a using(video_id) where v.channel_id=c.channel_id)),'[]'::jsonb),
  'videos',coalesce((select jsonb_agg(jsonb_build_object('video_id',v.video_id,'channel_id',v.channel_id,'title',v.title,
    'channel_title',c.title,'duration_seconds',v.duration_seconds,
    'topics',(select jsonb_agg(jsonb_build_object('node_id',l.node_id,'name',l.name) order by l.name)
     from approved a join agape.topic_labels l on l.node_id=a.node_id and l.locale=p_locale where a.video_id=v.video_id))
   order by v.created_at desc)
   from agape.videos v join agape.channels c using(channel_id)
   where c.user_id=p_user and exists(select 1 from approved a where a.video_id=v.video_id)),'[]'::jsonb),
  'tvs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'node_id',p.node_id,
    'topic',(select l.name from agape.topic_labels l where l.node_id=p.node_id and l.locale=p_locale),
    'latest_edition',(select jsonb_build_object('id',e.id,'published_at',e.published_at) from agape.tv_edition e
     where e.program_id=p.id order by e.published_at desc limit 1)) order by p.created_at)
   from agape.tv_program p where p.owner_id=p_user
    and (p.node_id is null or exists(select 1 from agape.ontology_node n where n.node_id=p.node_id and n.status='published'))),'[]'::jsonb),
  'ballot_results',coalesce((select jsonb_agg(r.result order by r.closes_at desc) from (
   select b.closes_at,jsonb_build_object('ballot_id',b.id,'ballot_title',b.title,'kind',b.kind,'topic',agape.topic_path(b.node_id),
    'closes_at',b.closes_at,'work_title',coalesce(vid.title,ed.title),'rank',(x->>'rank')::integer,'points',(x->>'points')::integer) as result
   from agape.ballot b join agape.ontology_node n on n.node_id=b.node_id and n.status='published'
   cross join lateral jsonb_array_elements(agape.ballot_results(b.id)->'board') x
   join agape.ballot_entry e on e.id=(x->>'entry_id')::uuid
   left join agape.videos vid on vid.video_id=e.video_id left join agape.tv_edition ed on ed.id=e.edition_id
   where clock_timestamp()>=b.closes_at and e.owner_id=p_user) r),'[]'::jsonb)) end;
$$;

-- Same as before, plus the creator's id so pages can link to their profile.
create or replace function agape.video_detail(p_video text,p_node uuid default null,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
  'video',(select to_jsonb(v)||jsonb_build_object('channel_title',c.title) from agape.videos v join agape.channels c using(channel_id) where v.video_id=p_video),
  'creator_id',(select c.user_id from agape.videos v join agape.channels c using(channel_id) where v.video_id=p_video),
  'topics',coalesce((select jsonb_agg(to_jsonb(l)) from agape.video_topics vt join agape.topic_labels l using(node_id)
    where vt.video_id=p_video and vt.status='approved' and l.locale=p_locale),'[]'::jsonb),
  'comments',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from (
    select c.id,c.user_id,c.body,c.created_at,coalesce((select ch.title from agape.channels ch where ch.user_id=c.user_id order by ch.verified_at desc limit 1),'Creator') as author
    from agape.comments c where video_id=p_video and node_id=p_node order by created_at desc limit 100
  ) c),'[]'::jsonb),
  'cues',coalesce((select jsonb_agg(to_jsonb(c) order by start_seconds) from agape.subtitle_cues c where video_id=p_video and locale=p_locale),'[]'::jsonb),
  'can_comment',agape.can_comment(p_video,p_node),
  'is_owner',agape.owns_video(p_video)
);
$$;

revoke all on function agape.discover_videos(uuid,integer),agape.creator_profile(uuid,text) from public;
grant execute on function agape.discover_videos(uuid,integer),agape.creator_profile(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
