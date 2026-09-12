create view agape.topic_labels with(security_invoker=true) as
select n.node_id,n.parent_id,n.slug,n.position,l.locale,
  coalesce(nn.name,en.name,n.slug) as name,
  coalesce(nn.description,en.description,'') as description,
  nn.node_id is null as is_fallback
from agape.ontology_node n cross join agape.locale l
left join agape.node_name nn on nn.node_id=n.node_id and nn.locale=l.locale
left join agape.node_name en on en.node_id=n.node_id and en.locale='en';
grant select on agape.topic_labels to anon,authenticated,service_role;

create function agape.browse(p_node uuid default null,p_locale text default 'en',p_query text default '',
  p_tag uuid default null,p_descendants boolean default true) returns jsonb
language sql stable security invoker set search_path='' as $$
with recursive
scope as (
  select n.node_id from agape.ontology_node n where p_node is null or
    n.node_id in (select node_id from agape.descendants(p_node))
),
ancestors as (
  select n.node_id,n.parent_id,0 as depth from agape.ontology_node n where n.node_id=p_node
  union all
  select n.node_id,n.parent_id,a.depth+1 from agape.ontology_node n join ancestors a on n.node_id=a.parent_id
),
labels as (select * from agape.topic_labels where locale=p_locale),
matching_nodes as (
  select n.node_id from agape.ontology_node n join scope s using(node_id)
  where (p_tag is null or exists(select 1 from agape.node_tag_effective t where t.node_id=n.node_id and t.tag_id=p_tag))
),
video_list as (
  select distinct v.*,c.title as channel_title
  from agape.videos v join agape.channels c using(channel_id)
  join agape.video_topics vt using(video_id) join matching_nodes m using(node_id)
  where vt.status='approved' and (p_descendants or p_node is null or vt.node_id=p_node)
    and (p_query='' or v.title ilike '%'||p_query||'%')
  order by v.created_at desc,v.video_id limit 100
),
clip_list as (
  select distinct f.*,v.title as video_title,c.title as channel_title
  from agape.fragments f join agape.videos v using(video_id) join agape.channels c using(channel_id)
  join agape.fragment_topics ft on ft.fragment_id=f.id join matching_nodes m on m.node_id=ft.node_id
  join agape.video_topics vt on vt.video_id=f.video_id and vt.node_id=ft.node_id and vt.status='approved'
  where ft.status='approved' and (p_descendants or p_node is null or ft.node_id=p_node)
  order by f.created_at,f.id limit 100
)
select jsonb_build_object(
  'node',(select to_jsonb(l) from labels l where node_id=p_node),
  'breadcrumbs',coalesce((select jsonb_agg(to_jsonb(l) order by a.depth desc) from ancestors a join labels l using(node_id)),'[]'::jsonb),
  'topics',coalesce((select jsonb_agg(to_jsonb(t) order by t.position,t.name) from (
    select l.*,(select count(*) from agape.ontology_node ch where ch.parent_id=l.node_id) as child_count
    from labels l join matching_nodes m using(node_id)
    where (case when p_query<>'' then l.name ilike '%'||p_query||'%' or l.description ilike '%'||p_query||'%'
      when p_tag is not null then true else l.parent_id is not distinct from p_node end)
    order by l.position,l.name limit 100
  ) t),'[]'::jsonb),
  'related',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('edge_type',e.edge_type) order by e.position,l.name)
    from agape.ontology_edge e join labels l on l.node_id=e.target_id where e.source_id=p_node),'[]'::jsonb),
  'videos',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.video_id) from video_list v),'[]'::jsonb),
  'fragments',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from clip_list f),'[]'::jsonb),
  'tags',coalesce((select jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'kind',t.kind,'name',coalesce(tn.name,en.name,t.code)) order by t.kind,t.code)
    from agape.tag t left join agape.tag_name tn on tn.tag_id=t.tag_id and tn.locale=p_locale
    left join agape.tag_name en on en.tag_id=t.tag_id and en.locale='en'),'[]'::jsonb),
  'locales',coalesce((select jsonb_agg(to_jsonb(l) order by l.locale) from agape.locale l),'[]'::jsonb)
);
$$;
revoke all on function agape.browse(uuid,text,text,uuid,boolean) from public;
grant execute on function agape.browse(uuid,text,text,uuid,boolean) to anon,authenticated,service_role;

create function agape.video_detail(p_video text,p_node uuid default null,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
  'video',(select to_jsonb(v)||jsonb_build_object('channel_title',c.title) from agape.videos v join agape.channels c using(channel_id) where v.video_id=p_video),
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
revoke all on function agape.video_detail(text,uuid,text) from public;
grant execute on function agape.video_detail(text,uuid,text) to anon,authenticated,service_role;
