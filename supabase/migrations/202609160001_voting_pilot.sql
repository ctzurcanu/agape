-- Voting pilot: topic-scoped peer recommendations limited by a contribution-based budget.
-- Pilot rules: 1 point per recommended work; points count against the budget only while their
-- ballot is open; votes stay sealed until the ballot closes.
create table agape.voting_budget_config (
 id bigint generated always as identity primary key,
 a numeric not null check(a>=0),
 b numeric not null check(b>=0),
 c numeric not null check(c>=0),
 z numeric not null check(z>=0),
 effective_at timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null,
 note text
);
insert into agape.voting_budget_config(a,b,c,z,effective_at,note)
values(3,1,0.25,1,'-infinity','Pilot starter coefficients (IDEAS.md, 2026-09-13)');

create table agape.voting_fine (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 amount numeric not null default 1 check(amount>0),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 imposed_by uuid references auth.users(id) on delete set null,
 imposed_at timestamptz not null default now(),
 revoked_at timestamptz,
 revoked_by uuid references auth.users(id) on delete set null
);
create index on agape.voting_fine(user_id);

create table agape.ballot (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('video','tv')),
 node_id uuid not null references agape.ontology_node(node_id) on delete restrict,
 title text not null check(length(trim(title)) between 1 and 160),
 opens_at timestamptz not null default now(),
 closes_at timestamptz not null,
 eligible_voters integer not null default 0,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check(closes_at>opens_at)
);
create index on agape.ballot(node_id,closes_at);
create table agape.ballot_entry (
 id uuid primary key default gen_random_uuid(),
 ballot_id uuid not null references agape.ballot(id) on delete cascade,
 video_id text references agape.videos(video_id) on delete cascade,
 edition_id uuid references agape.tv_edition(id) on delete cascade,
 program_id uuid references agape.tv_program(id) on delete cascade,
 owner_id uuid references auth.users(id) on delete set null,
 position integer not null,
 check((video_id is not null and edition_id is null and program_id is null)
  or (video_id is null and edition_id is not null and program_id is not null)),
 unique(ballot_id,video_id),
 unique(ballot_id,edition_id)
);
create table agape.ballot_vote (
 entry_id uuid not null references agape.ballot_entry(id) on delete cascade,
 voter_id uuid not null references auth.users(id) on delete cascade,
 ballot_id uuid not null references agape.ballot(id) on delete cascade,
 points integer not null default 1 check(points=1),
 explanation text check(explanation is null or length(explanation)<=500),
 basis_video_id text references agape.videos(video_id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(entry_id,voter_id)
);
create index on agape.ballot_vote(voter_id,ballot_id);
-- Every read and write goes through the functions below.
alter table agape.voting_budget_config enable row level security;
alter table agape.voting_fine enable row level security;
alter table agape.ballot enable row level security;
alter table agape.ballot_entry enable row level security;
alter table agape.ballot_vote enable row level security;
revoke all on agape.voting_budget_config,agape.voting_fine,agape.ballot,agape.ballot_entry,agape.ballot_vote from public,anon,authenticated;

create function agape.voting_config() returns agape.voting_budget_config language sql stable set search_path='' as $$
 select * from agape.voting_budget_config where effective_at<=now() order by effective_at desc,id desc limit 1;
$$;
-- voting_budget = a*videos + b*subtitles + c*comments_on_others - z*fines
create function agape.voting_earned(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with cfg as (select * from agape.voting_config()),
 counts as (select
  (select count(distinct v.video_id) from agape.videos v join agape.channels ch using(channel_id)
    join agape.video_topics vt using(video_id) where ch.user_id=p_user and vt.status='approved') as videos,
  (select count(*) from (select distinct h.program_id,h.track,(h.recorded_at at time zone 'UTC')::date
    from agape.tv_program_history h where h.editor=p_user) s) as subtitles,
  (select count(*) from agape.comments cm join agape.videos v using(video_id) join agape.channels ch using(channel_id)
    where cm.user_id=p_user and ch.user_id<>p_user) as comments,
  (select coalesce(sum(f.amount),0) from agape.voting_fine f where f.user_id=p_user and f.revoked_at is null) as fines)
 select jsonb_build_object('videos',videos,'subtitles',subtitles,'comments',comments,'fines',fines,
  'a',cfg.a,'b',cfg.b,'c',cfg.c,'z',cfg.z,
  'earned',cfg.a*videos+cfg.b*subtitles+cfg.c*comments-cfg.z*fines)
 from counts cross join cfg;
$$;
create function agape.voting_available(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select s.earned||jsonb_build_object('committed',x.committed,'available',(s.earned->>'earned')::numeric-x.committed)
 from (select agape.voting_earned(p_user) as earned) s
 cross join lateral (select count(*)::numeric as committed from agape.ballot_vote v join agape.ballot b on b.id=v.ballot_id
  where v.voter_id=p_user and clock_timestamp()<b.closes_at) x;
$$;
-- Same subtree rule as commenting; the qualifying video is the vote's eligibility snapshot.
create function agape.voter_basis(p_user uuid,p_node uuid) returns text language sql stable security definer set search_path='' as $$
 select v.video_id from agape.videos v join agape.channels c using(channel_id)
 join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
 where c.user_id=p_user and vt.status='approved'
  and v.verified_at>now()-interval '30 days' and c.verified_at>now()-interval '30 days'
 order by v.verified_at desc,v.video_id limit 1;
$$;
create function agape.ballot_entries_json(p_ballot uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'position',e.position,'kind',case when e.video_id is not null then 'video' else 'tv' end,
  'video_id',e.video_id,'edition_id',e.edition_id,'program_id',e.program_id,
  'title',coalesce(v.title,ed.title),'channel_title',ch.title,'duration_seconds',v.duration_seconds,
  'published_at',ed.published_at,'sections',jsonb_array_length(ed.fragments),
  'owner_is_me',coalesce(e.owner_id=auth.uid(),false)) order by e.position),'[]'::jsonb)
 from agape.ballot_entry e left join agape.videos v on v.video_id=e.video_id
 left join agape.channels ch on ch.channel_id=v.channel_id left join agape.tv_edition ed on ed.id=e.edition_id
 where e.ballot_id=p_ballot;
$$;
-- Recommended works ranked by points; ties share a rank; voters are never named.
create function agape.ballot_results(p_ballot uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with totals as (
  select e.id as entry_id,e.position,coalesce(sum(v.points),0) as points,count(v.voter_id) as voters,
   coalesce(jsonb_agg(v.explanation order by v.updated_at) filter(where v.explanation is not null),'[]'::jsonb) as explanations
  from agape.ballot_entry e left join agape.ballot_vote v on v.entry_id=e.id
  where e.ballot_id=p_ballot group by e.id,e.position
 ), ranked as (select t.*,rank() over(order by t.points desc) as rnk from totals t where t.points>0)
 select jsonb_build_object(
  'entries',(select count(*) from agape.ballot_entry where ballot_id=p_ballot),
  'provisional',(select count(*) from agape.ballot_entry where ballot_id=p_ballot)<3,
  'voters',(select count(distinct voter_id) from agape.ballot_vote where ballot_id=p_ballot),
  'board',coalesce((select jsonb_agg(jsonb_build_object('entry_id',r.entry_id,'rank',r.rnk,'points',r.points,'voters',r.voters,'explanations',r.explanations)
   order by r.rnk,r.position) from ranked r where r.rnk<=10),'[]'::jsonb));
$$;

create function agape.open_ballot(p_kind text,p_node uuid,p_title text,p_closes_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid; entries integer;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('video','tv') then raise exception 'Choose a video or TV ballot'; end if;
 if not exists(select 1 from agape.ontology_node where node_id=p_node and status='published') then raise exception 'Choose a published topic'; end if;
 if p_closes_at is null or p_closes_at<now()+interval '1 hour' or p_closes_at>now()+interval '90 days' then
  raise exception 'Close the ballot between one hour and 90 days from now'; end if;
 insert into agape.ballot(kind,node_id,title,closes_at,created_by,eligible_voters)
 values(p_kind,p_node,trim(p_title),p_closes_at,auth.uid(),
  (select count(distinct c.user_id) from agape.videos v join agape.channels c using(channel_id)
    join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
    where vt.status='approved' and v.verified_at>now()-interval '30 days' and c.verified_at>now()-interval '30 days'))
 returning id into new_id;
 -- Entries are frozen now; later approvals or editions join the next ballot.
 if p_kind='video' then
  insert into agape.ballot_entry(ballot_id,video_id,owner_id,position)
  select new_id,s.video_id,s.user_id,row_number() over(order by s.created_at,s.video_id) from (
   select distinct v.video_id,c.user_id,v.created_at from agape.videos v join agape.channels c using(channel_id)
   join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id) where vt.status='approved') s;
 else
  insert into agape.ballot_entry(ballot_id,edition_id,program_id,owner_id,position)
  select new_id,e.id,p.id,p.owner_id,row_number() over(order by p.created_at,p.id) from agape.tv_program p
  cross join lateral (select x.id from agape.tv_edition x where x.program_id=p.id order by x.published_at desc,x.id desc limit 1) e
  where p.node_id in(select node_id from agape.descendants(p_node));
 end if;
 get diagnostics entries=row_count;
 if entries<2 then raise exception 'A ballot needs at least two works to compare.'; end if;
 return new_id;
end $$;
create function agape.close_ballot(p_ballot uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 update agape.ballot set closes_at=clock_timestamp() where id=p_ballot and closes_at>clock_timestamp();
 if not found then raise exception 'Ballot not found or already closed' using errcode='40001'; end if;
end $$;

create function agape.ballot_list(p_node uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'title',b.title,'node_id',b.node_id,'topic',agape.topic_path(b.node_id),
  'opens_at',b.opens_at,'closes_at',b.closes_at,'open',clock_timestamp()<b.closes_at,
  'entries',(select count(*) from agape.ballot_entry e where e.ballot_id=b.id))
  order by (clock_timestamp()<b.closes_at) desc,b.closes_at desc),'[]'::jsonb)
 from agape.ballot b join agape.ontology_node n on n.node_id=b.node_id and n.status='published'
 where p_node is null or b.node_id in(select node_id from agape.descendants(p_node));
$$;
create function agape.ballot_view(p_ballot uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b agape.ballot; is_open boolean; me uuid:=auth.uid();
begin
 select * into b from agape.ballot where id=p_ballot;
 if not found or not exists(select 1 from agape.ontology_node where node_id=b.node_id and status='published') then return null; end if;
 is_open:=clock_timestamp()<b.closes_at;
 return jsonb_build_object(
  'ballot',jsonb_build_object('id',b.id,'kind',b.kind,'node_id',b.node_id,'topic',agape.topic_path(b.node_id),'title',b.title,
   'opens_at',b.opens_at,'closes_at',b.closes_at,'open',is_open,'eligible_voters',b.eligible_voters),
  'entries',agape.ballot_entries_json(p_ballot),
  'me',case when me is null then null else agape.voting_available(me)||jsonb_build_object(
   'eligible',agape.voter_basis(me,b.node_id) is not null,
   'votes',coalesce((select jsonb_agg(jsonb_build_object('entry_id',v.entry_id,'explanation',v.explanation))
    from agape.ballot_vote v where v.ballot_id=p_ballot and v.voter_id=me),'[]'::jsonb)) end,
  'results',case when is_open then null else agape.ballot_results(p_ballot) end);
end $$;

create function agape.cast_vote(p_ballot uuid,p_entry uuid,p_explanation text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); b agape.ballot; e agape.ballot_entry; basis text; note text:=nullif(trim(coalesce(p_explanation,'')),'');
begin
 if me is null then raise exception 'Sign in to vote' using errcode='42501'; end if;
 -- Serializes one voter's spending so concurrent votes cannot overspend the budget.
 perform pg_advisory_xact_lock(hashtextextended('ballot-voter:'||me::text,0));
 select * into b from agape.ballot where id=p_ballot;
 if not found then raise exception 'Ballot not found' using errcode='P0002'; end if;
 if clock_timestamp()>=b.closes_at then raise exception 'This ballot is closed.' using errcode='40001'; end if;
 select * into e from agape.ballot_entry where id=p_entry and ballot_id=p_ballot;
 if not found then raise exception 'This work is not part of the ballot' using errcode='P0002'; end if;
 if length(note)>500 then raise exception 'Keep the explanation under 500 characters.' using errcode='23514'; end if;
 basis:=agape.voter_basis(me,b.node_id);
 if basis is null then raise exception 'Only creators with a recently verified video approved in this topic can vote here.' using errcode='42501'; end if;
 if e.owner_id=me then raise exception 'You cannot recommend your own work.' using errcode='42501'; end if;
 update agape.ballot_vote set explanation=note,basis_video_id=basis,updated_at=now() where entry_id=p_entry and voter_id=me;
 if not found then
  if (agape.voting_available(me)->>'available')::numeric<1 then
   raise exception 'Your voting budget is fully committed. Withdraw a recommendation or wait for a ballot to close.' using errcode='54000'; end if;
  insert into agape.ballot_vote(entry_id,voter_id,ballot_id,explanation,basis_video_id) values(p_entry,me,p_ballot,note,basis);
 end if;
 return agape.voting_available(me);
end $$;
create function agape.withdraw_vote(p_ballot uuid,p_entry uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
 if me is null then raise exception 'Sign in to vote' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ballot-voter:'||me::text,0));
 if not exists(select 1 from agape.ballot where id=p_ballot and clock_timestamp()<closes_at) then raise exception 'This ballot is closed.' using errcode='40001'; end if;
 delete from agape.ballot_vote where ballot_id=p_ballot and entry_id=p_entry and voter_id=me;
 if not found then raise exception 'No recommendation to withdraw' using errcode='P0002'; end if;
 return agape.voting_available(me);
end $$;
create function agape.my_voting_budget() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to see your voting budget' using errcode='42501'; end if;
 return agape.voting_available(auth.uid())||jsonb_build_object('fines_detail',coalesce((
  select jsonb_agg(jsonb_build_object('id',f.id,'amount',f.amount,'reason',f.reason,'imposed_at',f.imposed_at,'revoked_at',f.revoked_at) order by f.imposed_at desc)
  from agape.voting_fine f where f.user_id=auth.uid()),'[]'::jsonb));
end $$;

create function agape.impose_fine(p_user uuid,p_amount numeric,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 insert into agape.voting_fine(user_id,amount,reason,imposed_by) values(p_user,coalesce(p_amount,1),trim(p_reason),auth.uid()) returning id into new_id;
 return new_id;
end $$;
create function agape.revoke_fine(p_fine uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 update agape.voting_fine set revoked_at=now(),revoked_by=auth.uid() where id=p_fine and revoked_at is null;
 if not found then raise exception 'Fine not found or already revoked' using errcode='40001'; end if;
end $$;
create function agape.ballot_audit(p_ballot uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if not exists(select 1 from agape.ballot where id=p_ballot and clock_timestamp()>=closes_at) then
  raise exception 'Votes stay sealed until the ballot closes.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('entry_id',v.entry_id,'title',coalesce(vid.title,ed.title),
   'voter',u.email,'voter_id',v.voter_id,'basis_video_id',v.basis_video_id,'explanation',v.explanation,'updated_at',v.updated_at)
   order by e.position,v.updated_at)
  from agape.ballot_vote v join agape.ballot_entry e on e.id=v.entry_id
  left join agape.videos vid on vid.video_id=e.video_id left join agape.tv_edition ed on ed.id=e.edition_id
  left join auth.users u on u.id=v.voter_id where v.ballot_id=p_ballot),'[]'::jsonb);
end $$;

revoke all on function agape.voting_config(),agape.voting_earned(uuid),agape.voting_available(uuid),agape.voter_basis(uuid,uuid),
 agape.ballot_entries_json(uuid),agape.ballot_results(uuid) from public,anon,authenticated;
revoke all on function agape.open_ballot(text,uuid,text,timestamptz),agape.close_ballot(uuid),agape.ballot_list(uuid),agape.ballot_view(uuid),
 agape.cast_vote(uuid,uuid,text),agape.withdraw_vote(uuid,uuid),agape.my_voting_budget(),agape.impose_fine(uuid,numeric,text),
 agape.revoke_fine(uuid),agape.ballot_audit(uuid) from public,anon;
grant execute on function agape.ballot_list(uuid),agape.ballot_view(uuid) to anon,authenticated;
grant execute on function agape.open_ballot(text,uuid,text,timestamptz),agape.close_ballot(uuid),agape.cast_vote(uuid,uuid,text),
 agape.withdraw_vote(uuid,uuid),agape.my_voting_budget(),agape.impose_fine(uuid,numeric,text),agape.revoke_fine(uuid),
 agape.ballot_audit(uuid) to authenticated;
notify pgrst,'reload schema';
