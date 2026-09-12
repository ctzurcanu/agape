-- Agape owns every object below. No Allways records or objects are modified.
create schema agape;
revoke all on schema agape from public;
grant usage on schema agape to anon, authenticated, service_role;

create table agape.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'creator' check (role in ('creator', 'admin'))
);
create table agape.locale (
  locale text primary key,
  name text not null,
  direction text not null default 'ltr' check (direction in ('ltr','rtl'))
);
insert into agape.locale values ('en','English','ltr'), ('fr','Français','ltr');
create table agape.ontology_node (
  node_id uuid primary key default gen_random_uuid(),
  parent_id uuid references agape.ontology_node(node_id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null default 'published' check (status in ('draft','published','archived')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (parent_id, slug),
  check (parent_id is distinct from node_id)
);
create index on agape.ontology_node(parent_id, position);
create table agape.node_name (
  node_id uuid references agape.ontology_node on delete cascade,
  locale text references agape.locale,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  primary key (node_id, locale)
);
create table agape.edge_type (
  code text primary key check (code in ('related','see_also')),
  name text not null
);
insert into agape.edge_type values ('related','Related'), ('see_also','See also');
-- Canonical parents live only in parent_id, avoiding duplicate hierarchy state.
create table agape.ontology_edge (
  source_id uuid references agape.ontology_node on delete cascade,
  target_id uuid references agape.ontology_node on delete cascade,
  edge_type text references agape.edge_type,
  position integer not null default 0,
  primary key (source_id,target_id,edge_type),
  check (source_id <> target_id)
);
create table agape.tag_kind (kind text primary key, name text not null);
create table agape.tag (
  tag_id uuid primary key default gen_random_uuid(),
  kind text not null references agape.tag_kind,
  code text not null,
  unique(kind,code)
);
create table agape.tag_name (
  tag_id uuid references agape.tag on delete cascade,
  locale text references agape.locale,
  name text not null,
  primary key(tag_id,locale)
);
create table agape.node_tag (
  node_id uuid references agape.ontology_node on delete cascade,
  tag_id uuid references agape.tag on delete cascade,
  primary key(node_id,tag_id)
);
create table agape.node_proposal (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references agape.ontology_node on delete restrict,
  name text not null check(length(trim(name)) between 1 and 120),
  description text not null default '' check(length(description)<=2000),
  proposed_by uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create table agape.translation_job (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references agape.ontology_node on delete cascade,
  locale text not null references agape.locale,
  status text not null default 'pending' check(status in ('pending','done','failed')),
  unique(node_id,locale)
);

create table agape.channels (
  channel_id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  verified_at timestamptz not null default now()
);
create index on agape.channels(user_id);
create table agape.videos (
  video_id text primary key check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
  channel_id text not null references agape.channels on delete cascade,
  title text not null,
  youtube_category_id text not null,
  duration_seconds integer not null check(duration_seconds>0),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table agape.video_topics (
  video_id text references agape.videos on delete cascade,
  node_id uuid references agape.ontology_node on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  primary key(video_id,node_id)
);
create index on agape.video_topics(node_id,status);
create table agape.fragments (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references agape.videos on delete cascade,
  title text not null check(length(trim(title)) between 1 and 160),
  start_seconds numeric not null check(start_seconds >= 0),
  end_seconds numeric not null check(end_seconds > start_seconds),
  created_at timestamptz not null default now()
);
create table agape.fragment_topics (
  fragment_id uuid references agape.fragments on delete cascade,
  node_id uuid references agape.ontology_node on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  primary key(fragment_id,node_id)
);
create table agape.comments (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references agape.videos on delete cascade,
  node_id uuid not null references agape.ontology_node on delete restrict,
  user_id uuid not null references auth.users on delete cascade,
  body text not null check(length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on agape.comments(video_id,node_id,created_at);
create table agape.subtitle_cues (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references agape.videos on delete cascade,
  locale text not null references agape.locale,
  start_seconds numeric not null check(start_seconds>=0),
  end_seconds numeric not null check(end_seconds>start_seconds),
  markdown text not null check(length(trim(markdown)) between 1 and 2000)
);
create index on agape.subtitle_cues(video_id,locale,start_seconds);

create function agape.guard_parent() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize topology edits so concurrent reparenting cannot introduce a cycle.
  perform pg_advisory_xact_lock(71423091);
  if new.parent_id is not null and exists (
    with recursive up as (
      select n.node_id,n.parent_id from agape.ontology_node n where n.node_id=new.parent_id
      union
      select n.node_id,n.parent_id from agape.ontology_node n join up on n.node_id=up.parent_id
    ) select 1 from up where node_id=new.node_id
  ) then raise exception 'A topic cannot be its own ancestor'; end if;
  return new;
end $$;
create trigger guard_parent before insert or update of parent_id on agape.ontology_node
for each row execute function agape.guard_parent();

create function agape.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from agape.members where user_id=auth.uid() and role='admin');
$$;
create function agape.owns_video(p_video text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from agape.videos v join agape.channels c using(channel_id)
    where v.video_id=p_video and c.user_id=auth.uid());
$$;
create function agape.descendants(p_node uuid) returns table(node_id uuid)
language sql stable set search_path = '' as $$
  with recursive down as (
    select n.node_id from agape.ontology_node n where n.node_id=p_node and n.status='published'
    union
    select n.node_id from agape.ontology_node n join down d on n.parent_id=d.node_id where n.status='published'
  ) select * from down;
$$;
create function agape.can_comment(p_video text,p_node uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists(select 1 from agape.video_topics vt join agape.descendants(p_node) d using(node_id)
      where vt.video_id=p_video and vt.status='approved')
    and exists(select 1 from agape.videos v join agape.channels c using(channel_id)
      join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
      where c.user_id=auth.uid() and vt.status='approved'
        and v.verified_at > now()-interval '30 days' and c.verified_at > now()-interval '30 days');
$$;

create view agape.node_tag_effective with(security_invoker=true) as
with recursive ancestors as (
  select node_id,node_id as ancestor_id,parent_id from agape.ontology_node where status='published'
  union
  select a.node_id,n.node_id,n.parent_id from ancestors a join agape.ontology_node n on n.node_id=a.parent_id
  where n.status='published'
)
select distinct a.node_id,t.tag_id from ancestors a join agape.node_tag t on t.node_id=a.ancestor_id;

-- All table access is opt-in. Authenticated graph mutations use controlled RPCs.
do $$ declare t text; begin
  foreach t in array array['members','locale','ontology_node','node_name','edge_type','ontology_edge',
    'tag_kind','tag','tag_name','node_tag','node_proposal','translation_job','channels','videos',
    'video_topics','fragments','fragment_topics','comments','subtitle_cues'] loop
    execute format('alter table agape.%I enable row level security',t);
  end loop;
end $$;
create policy members_self on agape.members for select to authenticated using(user_id=auth.uid());
create policy nodes_read on agape.ontology_node for select to anon,authenticated using(status='published');
create policy names_read on agape.node_name for select to anon,authenticated using(exists(select 1 from agape.ontology_node n where n.node_id=node_name.node_id));
create policy edges_read on agape.ontology_edge for select to anon,authenticated using(
  exists(select 1 from agape.ontology_node n where n.node_id=source_id)
  and exists(select 1 from agape.ontology_node n where n.node_id=target_id));
create policy node_tags_read on agape.node_tag for select to anon,authenticated using(exists(select 1 from agape.ontology_node n where n.node_id=node_tag.node_id));
do $$ declare t text; begin
  foreach t in array array['locale','edge_type','tag_kind','tag','tag_name'] loop
    execute format('create policy public_read on agape.%I for select to anon,authenticated using(true)',t);
  end loop;
end $$;
create policy channels_read on agape.channels for select to anon,authenticated using(true);
create policy videos_read on agape.videos for select to anon,authenticated using(
  agape.owns_video(video_id) or agape.is_admin() or exists(
    select 1 from agape.video_topics vt where vt.video_id=videos.video_id and vt.status='approved'));
create policy video_topics_read on agape.video_topics for select to anon,authenticated using(
  (status='approved' and exists(select 1 from agape.ontology_node n where n.node_id=video_topics.node_id))
  or agape.owns_video(video_id) or agape.is_admin());
create policy fragments_read on agape.fragments for select to anon,authenticated using(
  agape.owns_video(video_id) or agape.is_admin() or exists(
    select 1 from agape.fragment_topics ft where ft.fragment_id=fragments.id and ft.status='approved'));
create policy fragment_topics_read on agape.fragment_topics for select to anon,authenticated using(
  status='approved' and exists(select 1 from agape.ontology_node n where n.node_id=fragment_topics.node_id));
create policy comments_read on agape.comments for select to anon,authenticated using(
  exists(select 1 from agape.videos v where v.video_id=comments.video_id)
  and exists(select 1 from agape.ontology_node n where n.node_id=comments.node_id));
create policy comments_insert on agape.comments for insert to authenticated
  with check(user_id=auth.uid() and agape.can_comment(video_id,node_id));
create policy comments_delete on agape.comments for delete to authenticated using(user_id=auth.uid() or agape.is_admin());
create policy cues_read on agape.subtitle_cues for select to anon,authenticated using(exists(select 1 from agape.videos v where v.video_id=subtitle_cues.video_id));
create policy cues_insert on agape.subtitle_cues for insert to authenticated with check(agape.owns_video(video_id));
create policy cues_delete on agape.subtitle_cues for delete to authenticated using(agape.owns_video(video_id));
create policy proposals_read on agape.node_proposal for select to authenticated using(proposed_by=auth.uid() or agape.is_admin());
create policy proposals_insert on agape.node_proposal for insert to authenticated
  with check(proposed_by=auth.uid() and status='pending');

create function agape.guard_timing() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.end_seconds > (select duration_seconds from agape.videos where video_id=new.video_id) then
    raise exception 'End time exceeds video duration';
  end if;
  return new;
end $$;
create trigger fragment_timing before insert or update on agape.fragments for each row execute function agape.guard_timing();
create trigger cue_timing before insert or update on agape.subtitle_cues for each row execute function agape.guard_timing();

create function agape.create_topic(p_parent uuid,p_name text,p_description text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; slug text;
begin
  if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_parent is not null and not exists(select 1 from agape.ontology_node where node_id=p_parent and status='published') then
    raise exception 'Parent topic not available';
  end if;
  slug := trim(both '-' from regexp_replace(lower(p_name),'[^a-z0-9]+','-','g'));
  if slug='' then slug:='topic'; end if;
  insert into agape.ontology_node(parent_id,slug) values(p_parent,slug||'-'||substr(gen_random_uuid()::text,1,8)) returning node_id into result;
  insert into agape.node_name values(result,'en',trim(p_name),p_description);
  insert into agape.translation_job(node_id,locale) select result,locale from agape.locale where locale<>'en';
  return result;
end $$;

create function agape.submit_fragment(p_video text,p_node uuid,p_title text,p_start numeric,p_end numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not agape.owns_video(p_video) then raise exception 'Only the verified owner can submit fragments' using errcode='42501'; end if;
  if not exists(select 1 from agape.video_topics where video_id=p_video and node_id=p_node and status='approved') then
    raise exception 'The video must first be approved for this exact topic';
  end if;
  insert into agape.fragments(video_id,title,start_seconds,end_seconds) values(p_video,p_title,p_start,p_end) returning id into result;
  insert into agape.fragment_topics values(result,p_node,'approved');
  return result;
end $$;

create function agape.moderation_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return jsonb_build_object(
    'topics',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from agape.node_proposal p where status='pending'),'[]'::jsonb),
    'videos',coalesce((select jsonb_agg(jsonb_build_object('video_id',vt.video_id,'node_id',vt.node_id,'title',v.title,'topic',nn.name))
      from agape.video_topics vt join agape.videos v using(video_id) join agape.node_name nn on nn.node_id=vt.node_id and nn.locale='en'
      where vt.status='pending'),'[]'::jsonb));
end $$;
create function agape.moderate(p_kind text,p_id text,p_node uuid,p_approve boolean) returns void
language plpgsql security definer set search_path='' as $$
declare proposal agape.node_proposal;
begin
  if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_kind='topic' then
    select * into strict proposal from agape.node_proposal where id=p_id::uuid and status='pending' for update;
    if p_approve then perform agape.create_topic(proposal.parent_id,proposal.name,proposal.description); end if;
    update agape.node_proposal set status=case when p_approve then 'approved' else 'rejected' end where id=proposal.id;
  elsif p_kind='video' then
    update agape.video_topics set status=case when p_approve then 'approved' else 'rejected' end where video_id=p_id and node_id=p_node;
    if not found then raise exception 'Submission not found'; end if;
  else raise exception 'Unknown submission type'; end if;
end $$;

grant select on all tables in schema agape to anon,authenticated;
revoke select on agape.members,agape.node_proposal,agape.translation_job from anon;
revoke select on agape.translation_job from authenticated;
grant insert on agape.comments,agape.subtitle_cues,agape.node_proposal to authenticated;
grant delete on agape.comments,agape.subtitle_cues to authenticated;
grant all on all tables in schema agape to service_role;
grant all on all sequences in schema agape to service_role;
revoke execute on all functions in schema agape from public,anon,authenticated;
grant execute on function agape.is_admin(),agape.owns_video(text),agape.descendants(uuid),agape.can_comment(text,uuid) to anon,authenticated;
grant execute on function agape.create_topic(uuid,text,text),agape.submit_fragment(text,uuid,text,numeric,numeric),
  agape.moderation_queue(),agape.moderate(text,text,uuid,boolean) to authenticated;
grant execute on all functions in schema agape to service_role;
