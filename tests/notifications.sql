-- Notices for review decisions, ballots, and fines, with opt-in email delivery.
-- Self-contained fixtures; caller always rolls this transaction back.
insert into auth.users(id,email) values
 ('d0000000-0000-4000-8000-000000000001','owner@notice.test'),('d0000000-0000-4000-8000-000000000002','p@notice.test'),
 ('d0000000-0000-4000-8000-000000000003','admin@notice.test'),('d0000000-0000-4000-8000-000000000004','proposer@notice.test'),
 ('d0000000-0000-4000-8000-000000000005','bystander@notice.test');
insert into agape.members(user_id,role) values('d0000000-0000-4000-8000-000000000003','admin');
insert into agape.ontology_node(node_id,slug,status) values('d0000000-0000-4000-8000-000000000010','notice-topic','published');
insert into agape.node_name(node_id,locale,name) values('d0000000-0000-4000-8000-000000000010','en','Notice topic');
select agape.record_verified_video('d0000000-0000-4000-8000-000000000001','notice-o','Owner channel','noticevid01','Owner video','10',60,'d0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('d0000000-0000-4000-8000-000000000002','notice-p','P channel','noticevid02','P video','10',60,'d0000000-0000-4000-8000-000000000010');
insert into agape.node_proposal(id,parent_id,name,proposed_by) values('d0000000-0000-4000-8000-000000000020','d0000000-0000-4000-8000-000000000010','Proposed notice topic','d0000000-0000-4000-8000-000000000004');

-- Review decisions notify only the submitter, with the reason.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select agape.moderate('video','noticevid01','d0000000-0000-4000-8000-000000000010',false,'Wrong topic for this video');
select agape.moderate('video','noticevid02','d0000000-0000-4000-8000-000000000010',true);
select agape.moderate('topic','d0000000-0000-4000-8000-000000000020',null,true);
reset role;
do $$ begin
 if not exists(select 1 from agape.notification where user_id='d0000000-0000-4000-8000-000000000001' and kind='review' and title like '%not approved in Notice topic' and body like '%Wrong topic for this video%' and link='#/studio') then raise exception 'Rejection notice missing'; end if;
 if not exists(select 1 from agape.notification where user_id='d0000000-0000-4000-8000-000000000002' and kind='review' and title like 'Your video was approved%') then raise exception 'Approval notice missing'; end if;
 if not exists(select 1 from agape.notification where user_id='d0000000-0000-4000-8000-000000000004' and title='Your topic suggestion was approved') then raise exception 'Topic notice missing'; end if;
 if exists(select 1 from agape.notification where user_id in('d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000005')) then raise exception 'Notice sent to an uninvolved person'; end if;
end $$;
-- The owner resubmits and is approved; then a ballot opens for both eligible creators, and P is fined.
select agape.record_verified_video('d0000000-0000-4000-8000-000000000001','notice-o','Owner channel','noticevid01','Owner video','10',60,'d0000000-0000-4000-8000-000000000010');
set local role authenticated;
select agape.moderate('video','noticevid01','d0000000-0000-4000-8000-000000000010',true);
select set_config('notice.ballot',agape.open_ballot('video','d0000000-0000-4000-8000-000000000010','Notice ballot',now()+interval '7 days')::text,true);
select agape.impose_fine('d0000000-0000-4000-8000-000000000002',1,'Testing fines');
reset role;
do $$ begin
 if (select count(*) from agape.notification where kind='ballot' and link='#/ballot/'||current_setting('notice.ballot'))<>2
  or exists(select 1 from agape.notification where kind='ballot' and user_id not in('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')) then raise exception 'Ballot notices incorrect'; end if;
 if not exists(select 1 from agape.notification where user_id='d0000000-0000-4000-8000-000000000002' and kind='fine' and body like '%Testing fines%') then raise exception 'Fine notice missing'; end if;
end $$;

-- A creator sees and manages only their own notices; email is off by default.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare mine jsonb; first uuid; prefs jsonb; begin
 mine:=agape.my_notifications();
 if jsonb_array_length(mine->'items')<>3 or (mine->>'unread')::int<>3 or mine::text like '%owner@notice.test%' then raise exception 'Own notices incorrect: %',mine; end if;
 first:=(mine->'items'->0->>'id')::uuid;
 -- Separate statements: a stable function does not see changes made earlier in the same statement.
 if agape.mark_notifications_read(array[first])<>1 then raise exception 'Marking one notice read failed'; end if;
 if (agape.my_notifications()->>'unread')::int<>2 then raise exception 'Unread count not updated'; end if;
 if agape.mark_notifications_read(null)<>2 then raise exception 'Marking all notices read failed'; end if;
 prefs:=agape.my_notification_preferences();
 if (prefs->>'email_review')::boolean or (prefs->>'email_ballot')::boolean or (prefs->>'email_fine')::boolean then raise exception 'Email should be off by default'; end if;
 perform agape.set_notification_preferences(true,false,true);
 begin
  perform 1 from agape.notification limit 1;
  raise exception 'Direct notice table access allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.claim_notification_emails(10);
  raise exception 'Browser role claimed emails';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.unsubscribe_notifications(gen_random_uuid());
  raise exception 'Browser role called unsubscribe directly';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('notice.entry',(select id::text from agape.ballot_entry where ballot_id=current_setting('notice.ballot')::uuid and video_id='noticevid01'),true);
set local role authenticated;
select agape.cast_vote(current_setting('notice.ballot')::uuid,current_setting('notice.entry')::uuid);
reset role;

set local role anon;
do $$ begin
 begin
  perform agape.my_notifications();
  raise exception 'Anonymous notices allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Delivery claims only opted-in kinds, exactly once, and records results.
set local role service_role;
do $$ declare claimed jsonb; token uuid; begin
 claimed:=agape.claim_notification_emails(50);
 if jsonb_array_length(claimed)<>2 or exists(select 1 from jsonb_array_elements(claimed) c where c->>'kind' not in('review','fine') or c->>'email'<>'p@notice.test') then
  raise exception 'Claimed notices incorrect: %',claimed; end if;
 if jsonb_array_length(agape.claim_notification_emails(50))<>0 then raise exception 'Notices claimed twice'; end if;
 perform agape.record_notification_email((claimed->0->>'id')::uuid,true);
 perform agape.record_notification_email((claimed->1->>'id')::uuid,false,'Resend 500');
 token:=(claimed->0->>'unsubscribe_token')::uuid;
 if not agape.unsubscribe_notifications(token) then raise exception 'Unsubscribe failed'; end if;
 if agape.unsubscribe_notifications(gen_random_uuid()) then raise exception 'Unknown unsubscribe token accepted'; end if;
 perform set_config('notice.sent',claimed->0->>'id',true),set_config('notice.failed',claimed->1->>'id',true),set_config('notice.token',token::text,true);
end $$;
reset role;
-- Like the delivery function, the service role only uses the functions above; check the tables directly here.
do $$ begin
 if not exists(select 1 from agape.notification where id=current_setting('notice.sent')::uuid and emailed_at is not null and email_error is null)
  or not exists(select 1 from agape.notification where id=current_setting('notice.failed')::uuid and emailed_at is null and email_error='Resend 500') then raise exception 'Delivery results not recorded'; end if;
 if exists(select 1 from agape.notification_preference where unsubscribe_token=current_setting('notice.token')::uuid and (email_review or email_ballot or email_fine)) then raise exception 'Unsubscribe left email on'; end if;
end $$;

-- Closed ballots notify voters and work owners once.
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select agape.close_ballot(current_setting('notice.ballot')::uuid);
reset role;
set local role service_role;
do $$ begin
 if agape.notify_closed_ballots()<>2 then raise exception 'Closed ballot notices incorrect'; end if;
 if agape.notify_closed_ballots()<>0 then raise exception 'Closed ballot notified twice'; end if;
end $$;
reset role;
