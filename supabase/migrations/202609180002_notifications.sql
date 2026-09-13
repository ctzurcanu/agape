-- In-app notices for review decisions, ballots, and fines, with opt-in email delivery.
create table agape.notification (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('review','ballot','fine')),
 title text not null check(length(title) between 1 and 200),
 body text not null default '' check(length(body)<=2000),
 link text check(link is null or link ~ '^#/'),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 email_claimed_at timestamptz,
 emailed_at timestamptz,
 email_error text
);
create index on agape.notification(user_id,created_at desc);
create index on agape.notification(created_at) where emailed_at is null and email_error is null;
create table agape.notification_preference (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email_review boolean not null default false,
 email_ballot boolean not null default false,
 email_fine boolean not null default false,
 unsubscribe_token uuid not null unique default gen_random_uuid(),
 updated_at timestamptz not null default now()
);
alter table agape.ballot add column closed_notified_at timestamptz;
alter table agape.notification enable row level security;
alter table agape.notification_preference enable row level security;
revoke all on agape.notification,agape.notification_preference from public,anon,authenticated;

create function agape.notify(p_user uuid,p_kind text,p_title text,p_body text,p_link text) returns void
language sql security definer set search_path='' as $$
 insert into agape.notification(user_id,kind,title,body,link)
 select p_user,p_kind,left(p_title,200),left(coalesce(p_body,''),2000),p_link where p_user is not null;
$$;

-- Review decisions now notify the submitter.
create or replace function agape.moderate(p_kind text,p_id text,p_node uuid,p_approve boolean,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare proposal agape.node_proposal; placement agape.video_topics; note text:=nullif(trim(coalesce(p_reason,'')),''); created uuid;
 owner uuid; video_title text;
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
  perform agape.notify(proposal.proposed_by,'review',
   case when p_approve then 'Your topic suggestion was approved' else 'Your topic suggestion was not approved' end,
   '“'||proposal.name||'”'||coalesce(': '||note,''),'#/studio');
 elsif p_kind='video' then
  select * into placement from agape.video_topics where video_id=p_id and node_id=p_node for update;
  if not found then raise exception 'Submission not found' using errcode='P0002'; end if;
  if placement.status<>'pending' then raise exception 'Already reviewed. Refresh the review list.' using errcode='40001'; end if;
  update agape.video_topics set status=case when p_approve then 'approved' else 'rejected' end where video_id=p_id and node_id=p_node;
  insert into agape.moderation_decision(kind,video_id,node_id,decision,reason,decided_by)
  values('video',p_id,p_node,case when p_approve then 'approved' else 'rejected' end,note,auth.uid());
  select c.user_id,v.title into owner,video_title from agape.videos v join agape.channels c using(channel_id) where v.video_id=p_id;
  perform agape.notify(owner,'review',
   case when p_approve then 'Your video was approved in ' else 'Your video was not approved in ' end||agape.topic_path(p_node),
   '“'||video_title||'”'||coalesce(': '||note,''),'#/studio');
 else raise exception 'Unknown submission type'; end if;
end $$;

-- Opening a ballot notifies every creator eligible to vote in it.
create or replace function agape.open_ballot(p_kind text,p_node uuid,p_title text,p_closes_at timestamptz) returns uuid
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
 insert into agape.notification(user_id,kind,title,body,link)
 select distinct c.user_id,'ballot',left('A ballot opened in '||agape.topic_path(p_node),200),
  trim(p_title)||' — recommend works until '||to_char(p_closes_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.','#/ballot/'||new_id
 from agape.videos v join agape.channels c using(channel_id)
 join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
 where vt.status='approved' and v.verified_at>now()-interval '30 days' and c.verified_at>now()-interval '30 days';
 return new_id;
end $$;

create or replace function agape.impose_fine(p_user uuid,p_amount numeric,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 insert into agape.voting_fine(user_id,amount,reason,imposed_by) values(p_user,coalesce(p_amount,1),trim(p_reason),auth.uid()) returning id into new_id;
 perform agape.notify(p_user,'fine','A fine was recorded on your voting budget',
  'Amount '||coalesce(p_amount,1)::text||': '||trim(p_reason),'#/studio');
 return new_id;
end $$;

-- Called by the delivery job; each closed ballot notifies its voters and work owners once.
create function agape.notify_closed_ballots() returns integer language plpgsql security definer set search_path='' as $$
declare b agape.ballot; total integer:=0; n integer;
begin
 for b in select * from agape.ballot where clock_timestamp()>=closes_at and closed_notified_at is null order by closes_at for update skip locked loop
  insert into agape.notification(user_id,kind,title,body,link)
  select people.person,'ballot',left('Results are in: '||b.title,200),
   'The ballot in '||agape.topic_path(b.node_id)||' has closed. See the ranked results.','#/ballot/'||b.id
  from (select voter_id as person from agape.ballot_vote where ballot_id=b.id
   union select owner_id from agape.ballot_entry where ballot_id=b.id and owner_id is not null) people;
  get diagnostics n=row_count; total:=total+n;
  update agape.ballot set closed_notified_at=now() where id=b.id;
 end loop;
 return total;
end $$;

create function agape.my_notifications(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to see your notices' using errcode='42501'; end if;
 return jsonb_build_object(
  'unread',(select count(*) from agape.notification where user_id=auth.uid() and read_at is null),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'title',n.title,'body',n.body,'link',n.link,
    'created_at',n.created_at,'read_at',n.read_at,'emailed_at',n.emailed_at) order by n.created_at desc)
   from (select * from agape.notification where user_id=auth.uid() order by created_at desc
    limit least(greatest(coalesce(p_limit,50),1),200)) n),'[]'::jsonb));
end $$;
create function agape.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null then raise exception 'Sign in to manage your notices' using errcode='42501'; end if;
 update agape.notification set read_at=now() where user_id=auth.uid() and read_at is null and (p_ids is null or id=any(p_ids));
 get diagnostics n=row_count;
 return n;
end $$;
create function agape.my_notification_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to manage email notices' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('email_review',p.email_review,'email_ballot',p.email_ballot,'email_fine',p.email_fine)
  from agape.notification_preference p where p.user_id=auth.uid()),
  jsonb_build_object('email_review',false,'email_ballot',false,'email_fine',false));
end $$;
create function agape.set_notification_preferences(p_review boolean,p_ballot boolean,p_fine boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to manage email notices' using errcode='42501'; end if;
 insert into agape.notification_preference(user_id,email_review,email_ballot,email_fine)
 values(auth.uid(),coalesce(p_review,false),coalesce(p_ballot,false),coalesce(p_fine,false))
 on conflict(user_id) do update set email_review=excluded.email_review,email_ballot=excluded.email_ballot,
  email_fine=excluded.email_fine,updated_at=now();
 return agape.my_notification_preferences();
end $$;

-- Service-only delivery API. Claims are exclusive; failed sends are recorded and not retried.
create function agape.claim_notification_emails(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claimed jsonb;
begin
 with picked as (
  select n.id from agape.notification n join agape.notification_preference p on p.user_id=n.user_id
  where n.emailed_at is null and n.email_error is null and n.created_at>now()-interval '7 days'
   and (n.email_claimed_at is null or n.email_claimed_at<now()-interval '1 hour')
   and ((n.kind='review' and p.email_review) or (n.kind='ballot' and p.email_ballot) or (n.kind='fine' and p.email_fine))
  order by n.created_at limit least(greatest(coalesce(p_limit,50),1),200)
  for update of n skip locked
 ), stamped as (
  update agape.notification n set email_claimed_at=now() from picked where n.id=picked.id returning n.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'title',s.title,'body',s.body,'link',s.link,
  'email',u.email,'unsubscribe_token',p.unsubscribe_token) order by s.created_at),'[]'::jsonb) into claimed
 from stamped s join auth.users u on u.id=s.user_id join agape.notification_preference p on p.user_id=s.user_id
 where u.email is not null;
 return claimed;
end $$;
create function agape.record_notification_email(p_id uuid,p_ok boolean,p_error text default null) returns void
language sql security definer set search_path='' as $$
 update agape.notification set emailed_at=case when p_ok then now() end,
  email_error=case when p_ok then null else left(coalesce(p_error,'Delivery failed'),500) end
 where id=p_id;
$$;
create function agape.unsubscribe_notifications(p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update agape.notification_preference set email_review=false,email_ballot=false,email_fine=false,updated_at=now()
 where unsubscribe_token=p_token;
 return found;
end $$;

-- Deleting one's Agape data also removes notices and email preferences.
create or replace function agape.delete_my_agape_data(p_confirm text) returns jsonb
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
 delete from agape.notification where user_id=me;
 get diagnostics n=row_count; counts:=counts||jsonb_build_object('notices',n);
 delete from agape.notification_preference where user_id=me;
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

revoke all on function agape.notify(uuid,text,text,text,text),agape.notify_closed_ballots(),agape.claim_notification_emails(integer),
 agape.record_notification_email(uuid,boolean,text),agape.unsubscribe_notifications(uuid) from public,anon,authenticated;
grant execute on function agape.notify_closed_ballots(),agape.claim_notification_emails(integer),
 agape.record_notification_email(uuid,boolean,text),agape.unsubscribe_notifications(uuid) to service_role;
revoke all on function agape.my_notifications(integer),agape.mark_notifications_read(uuid[]),agape.my_notification_preferences(),
 agape.set_notification_preferences(boolean,boolean,boolean) from public,anon;
grant execute on function agape.my_notifications(integer),agape.mark_notifications_read(uuid[]),agape.my_notification_preferences(),
 agape.set_notification_preferences(boolean,boolean,boolean) to authenticated;
notify pgrst,'reload schema';
