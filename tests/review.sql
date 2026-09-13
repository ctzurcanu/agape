-- Review decisions and submission status. Self-contained; caller always rolls this transaction back.
insert into auth.users(id,email) values
 ('ae000000-0000-4000-8000-000000000001','owner@example.org'),('ae000000-0000-4000-8000-000000000002','other@example.org'),
 ('ae000000-0000-4000-8000-000000000003','admin@example.org'),('ae000000-0000-4000-8000-000000000004','member@example.org');
insert into agape.members(user_id,role) values('ae000000-0000-4000-8000-000000000003','admin');
insert into agape.ontology_node(node_id,slug,status) values('ae000000-0000-4000-8000-000000000010','review-topic','published');
insert into agape.node_name(node_id,locale,name) values('ae000000-0000-4000-8000-000000000010','en','Review topic');
select agape.record_verified_video('ae000000-0000-4000-8000-000000000001','review-owner','Owner channel','reviewvid01','Owner video','10',120,'ae000000-0000-4000-8000-000000000010');
select agape.record_verified_video('ae000000-0000-4000-8000-000000000002','review-other','Other channel','reviewvid02','Other video','10',120,'ae000000-0000-4000-8000-000000000010');
insert into agape.node_proposal(id,parent_id,name,description,proposed_by)
values('ae000000-0000-4000-8000-000000000020','ae000000-0000-4000-8000-000000000010','Proposed child','Why it helps','ae000000-0000-4000-8000-000000000004');

set local role anon;
do $$ begin
 begin
  perform agape.my_submissions();
  raise exception 'Anonymous submission status allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.moderation_queue();
  raise exception 'Anonymous review queue allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Creators see their own pending work but cannot review.
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare mine jsonb; begin
 begin
  perform agape.moderation_queue();
  raise exception 'Non-admin review queue allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.moderate('video','reviewvid01','ae000000-0000-4000-8000-000000000010',true);
  raise exception 'Non-admin moderation allowed';
 exception when insufficient_privilege then null; end;
 mine:=agape.my_submissions();
 if jsonb_array_length(mine->'placements')<>1 or mine->'placements'->0->>'status'<>'pending' or mine->'placements'->0->>'topic'<>'Review topic' then
  raise exception 'Owner cannot see pending placement'; end if;
end $$;

-- Rejections need a reason; decisions are atomic and cannot be overwritten.
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000003',true);
do $$ declare q jsonb; begin
 q:=agape.moderation_queue();
 if not exists(select 1 from jsonb_array_elements(q->'videos') v where v->>'video_id'='reviewvid01' and v->>'channel_title'='Owner channel' and v->>'topic'='Review topic' and (v->>'approved_placements')::integer=0) then
  raise exception 'Review queue lacks video context'; end if;
 if not exists(select 1 from jsonb_array_elements(q->'topics') t where t->>'id'='ae000000-0000-4000-8000-000000000020' and t->>'parent'='Review topic' and t->>'proposer'='Signed-in member') then
  raise exception 'Review queue lacks topic context'; end if;
 begin
  perform agape.moderate('video','reviewvid01','ae000000-0000-4000-8000-000000000010',false,'   ');
  raise exception 'Rejection without a reason accepted';
 exception when check_violation then null; end;
 if (select status from agape.video_topics where video_id='reviewvid01')<>'pending' or exists(select 1 from agape.moderation_decision) then
  raise exception 'Failed rejection changed state'; end if;
 perform agape.moderate('video','reviewvid01','ae000000-0000-4000-8000-000000000010',false,'Please choose the Poetry topic');
 begin
  perform agape.moderate('video','reviewvid01','ae000000-0000-4000-8000-000000000010',true);
  raise exception 'Second decision accepted';
 exception when serialization_failure then null; end;
 if (select status from agape.video_topics where video_id='reviewvid01')<>'rejected' or (select count(*) from agape.moderation_decision where video_id='reviewvid01')<>1 then
  raise exception 'First decision not preserved'; end if;
 perform agape.moderate('video','reviewvid02','ae000000-0000-4000-8000-000000000010',true);
 perform agape.moderate('topic','ae000000-0000-4000-8000-000000000020',null,true,'Welcome');
 if not exists(select 1 from agape.node_proposal where id='ae000000-0000-4000-8000-000000000020' and status='approved' and created_node_id is not null) then
  raise exception 'Approved topic not linked to its proposal'; end if;
 q:=agape.moderation_queue();
 if jsonb_array_length(q->'recent')<>3 or q->'recent'->0->>'subject'<>'Proposed child' or q->'recent'->0->>'decided_by'<>'admin@example.org' then
  raise exception 'Recent decisions incomplete'; end if;
end $$;

-- The owner sees the reason, but not who decided.
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000001',true);
do $$ declare mine jsonb; begin
 mine:=agape.my_submissions();
 if mine->'placements'->0->>'status'<>'rejected' or mine->'placements'->0->>'reason'<>'Please choose the Poetry topic' then
  raise exception 'Owner cannot see rejection reason'; end if;
 if mine::text like '%admin@example.org%' or mine::text like '%ae000000-0000-4000-8000-000000000003%' then raise exception 'Decider exposed to submitter'; end if;
 begin
  perform decided_by from agape.moderation_decision limit 1;
  raise exception 'Decider column readable by submitter';
 exception when insufficient_privilege then null; end;
end $$;

-- Other creators cannot see someone else's rejected placement or its decision.
select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from agape.moderation_decision where video_id='reviewvid01') or exists(select 1 from agape.video_topics where video_id='reviewvid01') then
  raise exception 'Another creator sees a rejected placement'; end if;
 if jsonb_array_length(agape.my_submissions()->'placements')<>1 or agape.my_submissions()->'placements'->0->>'status'<>'approved' then
  raise exception 'Approved placement missing from its owner'; end if;
end $$;

select set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000004',true);
do $$ declare mine jsonb; begin
 mine:=agape.my_submissions();
 if mine->'topics'->0->>'status'<>'approved' or mine->'topics'->0->>'created_node_id' is null or mine->'topics'->0->>'reason'<>'Welcome' then
  raise exception 'Proposer cannot see the decision on their topic'; end if;
end $$;
reset role;

-- Resubmitting a rejected video re-queues it and keeps its decision history.
update agape.video_topics set submitted_at=now()-interval '1 day' where video_id='reviewvid01';
select agape.record_verified_video('ae000000-0000-4000-8000-000000000001','review-owner','Owner channel','reviewvid01','Owner video','10',120,'ae000000-0000-4000-8000-000000000010');
do $$ begin
 if not exists(select 1 from agape.video_topics where video_id='reviewvid01' and status='pending' and submitted_at>now()-interval '1 hour')
  or (select count(*) from agape.moderation_decision where video_id='reviewvid01')<>1 then
  raise exception 'Resubmission did not re-queue with history'; end if;
end $$;
