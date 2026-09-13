-- Voting pilot: budgets, eligibility, exclusions, sealed ballots, and results.
-- Self-contained fixtures; caller always rolls this transaction back.
insert into auth.users(id,email) values
 ('af000000-0000-4000-8000-000000000001','admin@vote.test'),('af000000-0000-4000-8000-000000000002','a@vote.test'),
 ('af000000-0000-4000-8000-000000000003','b@vote.test'),('af000000-0000-4000-8000-000000000004','sibling@vote.test'),
 ('af000000-0000-4000-8000-000000000005','member@vote.test'),('af000000-0000-4000-8000-000000000006','expired@vote.test');
insert into agape.members(user_id,role) values('af000000-0000-4000-8000-000000000001','admin');
insert into agape.ontology_node(node_id,slug,status) values('af000000-0000-4000-8000-000000000010','vote-parent','published'),('af000000-0000-4000-8000-000000000013','vote-other','published');
insert into agape.ontology_node(node_id,parent_id,slug,status) values
 ('af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000010','vote-child','published'),
 ('af000000-0000-4000-8000-000000000012','af000000-0000-4000-8000-000000000010','vote-sibling','published');
-- Creators A and B in the child topic, a sibling-topic creator, and a creator whose verification expired.
select agape.record_verified_video('af000000-0000-4000-8000-000000000002','vote-a','A channel','votevideoaa','A video','10',120,'af000000-0000-4000-8000-000000000011');
select agape.record_verified_video('af000000-0000-4000-8000-000000000002','vote-a','A channel','votevideoaa','A video','10',120,'af000000-0000-4000-8000-000000000012');
select agape.record_verified_video('af000000-0000-4000-8000-000000000003','vote-b','B channel','votevideobb','B video','10',120,'af000000-0000-4000-8000-000000000011');
-- Approved only after the ballots open; its owner's channel verification expires, so it changes no budget or eligibility.
select agape.record_verified_video('af000000-0000-4000-8000-000000000006','vote-d','Expired channel','votevideoee','Late video','10',120,'af000000-0000-4000-8000-000000000011');
select agape.record_verified_video('af000000-0000-4000-8000-000000000004','vote-c','Sibling channel','votevideocc','Sibling video','10',120,'af000000-0000-4000-8000-000000000012');
select agape.record_verified_video('af000000-0000-4000-8000-000000000006','vote-d','Expired channel','votevideodd','Expired video','10',120,'af000000-0000-4000-8000-000000000011');
update agape.video_topics set status='approved' where video_id in('votevideoaa','votevideobb','votevideocc','votevideodd');
update agape.videos set verified_at=now()-interval '40 days' where video_id='votevideodd';
update agape.channels set verified_at=now()-interval '40 days' where channel_id='vote-d';
-- Named TVs with published editions: B's in the child topic, A's in the sibling topic, and one never published.
insert into agape.tv_program(id,node_id,owner_id,title) values
 ('af000000-0000-4000-8000-000000000030','af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000003','B TV'),
 ('af000000-0000-4000-8000-000000000031','af000000-0000-4000-8000-000000000012','af000000-0000-4000-8000-000000000002','A TV'),
 ('af000000-0000-4000-8000-000000000032','af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000004','Unpublished TV');
insert into agape.tv_edition(id,program_id,title,revision,fragments,tracks,published_by) values
 ('af000000-0000-4000-8000-000000000040','af000000-0000-4000-8000-000000000030','B TV',1,'[]','[]','af000000-0000-4000-8000-000000000003'),
 ('af000000-0000-4000-8000-000000000041','af000000-0000-4000-8000-000000000031','A TV',1,'[]','[]','af000000-0000-4000-8000-000000000002');
-- A's contributions: two subtitle saves on one TV track in one day count once; another track counts again.
insert into agape.tv_program_history(program_id,track,locale,revision,cues,editor) values
 ('af000000-0000-4000-8000-000000000030','version1','en',1,'[]','af000000-0000-4000-8000-000000000002'),
 ('af000000-0000-4000-8000-000000000030','version1','en',2,'[]','af000000-0000-4000-8000-000000000002'),
 ('af000000-0000-4000-8000-000000000030','version2','en',1,'[]','af000000-0000-4000-8000-000000000002');
-- Comments on others' videos count; comments on one's own video do not.
insert into agape.comments(video_id,node_id,user_id,body) values
 ('votevideobb','af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000002','Lovely'),
 ('votevideobb','af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000002','Again'),
 ('votevideoaa','af000000-0000-4000-8000-000000000011','af000000-0000-4000-8000-000000000002','My own');

set local role anon;
do $$ begin
 if agape.ballot_list(null)<>'[]'::jsonb then raise exception 'Unexpected ballots'; end if;
 begin
  perform agape.open_ballot('video','af000000-0000-4000-8000-000000000011','Anonymous',now()+interval '7 days');
  raise exception 'Anonymous ballot opening allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from agape.ballot_vote limit 1;
  raise exception 'Anonymous vote table access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Administration: fines, and ballots whose works are frozen when they open.
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare revoked uuid; denied boolean; begin
 perform agape.impose_fine('af000000-0000-4000-8000-000000000002',1,'Repeated trivial comments');
 revoked:=agape.impose_fine('af000000-0000-4000-8000-000000000002',2,'Imposed by mistake');
 perform agape.revoke_fine(revoked);
 begin
  perform agape.revoke_fine(revoked);
  raise exception 'Fine revoked twice';
 exception when serialization_failure then null; end;
 perform agape.impose_fine('af000000-0000-4000-8000-000000000003',1,'Budget cap test');
 perform set_config('vote.video',agape.open_ballot('video','af000000-0000-4000-8000-000000000011','Child videos',now()+interval '7 days')::text,true);
 perform set_config('vote.tv',agape.open_ballot('tv','af000000-0000-4000-8000-000000000010','Parent TVs',now()+interval '7 days')::text,true);
 denied:=false;
 begin
  perform agape.open_ballot('video','af000000-0000-4000-8000-000000000013','Too few',now()+interval '7 days');
 exception when others then denied:=true; end;
 if not denied then raise exception 'Ballot with fewer than two works opened'; end if;
 denied:=false;
 begin
  perform agape.open_ballot('video','af000000-0000-4000-8000-000000000011','Too soon',now()+interval '10 minutes');
 exception when others then denied:=true; end;
 if not denied then raise exception 'Ballot closing within an hour opened'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from agape.ballot_entry where ballot_id=current_setting('vote.video')::uuid)<>3
  or exists(select 1 from agape.ballot_entry where ballot_id=current_setting('vote.video')::uuid and video_id is null) then raise exception 'Video ballot entries incorrect'; end if;
 if (select count(*) from agape.ballot_entry where ballot_id=current_setting('vote.tv')::uuid)<>2
  or exists(select 1 from agape.ballot_entry where ballot_id=current_setting('vote.tv')::uuid and edition_id is null) then raise exception 'TV ballot entries incorrect'; end if;
 if (select eligible_voters from agape.ballot where id=current_setting('vote.video')::uuid)<>2 then raise exception 'Eligible voter snapshot incorrect'; end if;
end $$;
select set_config('entry.aa',(select id::text from agape.ballot_entry where ballot_id=current_setting('vote.video')::uuid and video_id='votevideoaa'),true),
 set_config('entry.bb',(select id::text from agape.ballot_entry where ballot_id=current_setting('vote.video')::uuid and video_id='votevideobb'),true),
 set_config('entry.dd',(select id::text from agape.ballot_entry where ballot_id=current_setting('vote.video')::uuid and video_id='votevideodd'),true),
 set_config('entry.btv',(select id::text from agape.ballot_entry where ballot_id=current_setting('vote.tv')::uuid and program_id='af000000-0000-4000-8000-000000000030'),true),
 set_config('entry.atv',(select id::text from agape.ballot_entry where ballot_id=current_setting('vote.tv')::uuid and program_id='af000000-0000-4000-8000-000000000031'),true);
-- A video approved after opening does not join the open ballot.
update agape.video_topics set status='approved' where video_id='votevideoee';
do $$ begin
 if exists(select 1 from agape.ballot_entry where video_id='votevideoee') then raise exception 'Entries not frozen at opening'; end if;
end $$;

select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare v uuid:=current_setting('vote.video')::uuid; t uuid:=current_setting('vote.tv')::uuid; budget jsonb; view jsonb; begin
 begin
  perform agape.open_ballot('video','af000000-0000-4000-8000-000000000011','Not admin',now()+interval '7 days');
  raise exception 'Non-admin ballot opening allowed';
 exception when insufficient_privilege then null; end;
 -- 3*1 video + 1*2 subtitle versions + 0.25*2 comments - 1*1 fine
 budget:=agape.my_voting_budget();
 if (budget->>'videos')::int<>1 or (budget->>'subtitles')::int<>2 or (budget->>'comments')::int<>2 or (budget->>'fines')::numeric<>1 or (budget->>'earned')::numeric<>4.5 then
  raise exception 'Budget formula incorrect: %',budget; end if;
 begin
  perform agape.cast_vote(v,current_setting('entry.aa')::uuid);
  raise exception 'Self-vote on own video accepted';
 exception when insufficient_privilege then null; end;
 perform agape.cast_vote(v,current_setting('entry.bb')::uuid,'Clear and moving');
 budget:=agape.cast_vote(v,current_setting('entry.bb')::uuid,'Clear, moving, and well sourced');
 if (budget->>'committed')::numeric<>1 or (budget->>'available')::numeric<>3.5 then raise exception 'Re-casting spent another point'; end if;
 begin
  perform agape.cast_vote(t,current_setting('entry.bb')::uuid);
  raise exception 'Entry from another ballot accepted';
 exception when no_data_found then null; end;
 begin
  perform agape.cast_vote(t,current_setting('entry.atv')::uuid);
  raise exception 'Self-vote on own TV accepted';
 exception when insufficient_privilege then null; end;
 perform agape.cast_vote(t,current_setting('entry.btv')::uuid);
 view:=agape.ballot_view(v);
 if view->'results'<>'null'::jsonb or jsonb_array_length(view->'me'->'votes')<>1 or not (view->'me'->>'eligible')::boolean then raise exception 'Open ballot view incorrect: %',view; end if;
end $$;

-- B's budget is 3 - 1 fine = 2: a third recommendation waits for a withdrawal.
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000003',true);
do $$ declare v uuid:=current_setting('vote.video')::uuid; t uuid:=current_setting('vote.tv')::uuid; view jsonb; begin
 perform agape.cast_vote(v,current_setting('entry.aa')::uuid,'Beautiful');
 perform agape.cast_vote(v,current_setting('entry.dd')::uuid);
 begin
  perform agape.cast_vote(t,current_setting('entry.atv')::uuid);
  raise exception 'Budget cap not enforced';
 exception when program_limit_exceeded then null; end;
 perform agape.withdraw_vote(v,current_setting('entry.dd')::uuid);
 perform agape.cast_vote(t,current_setting('entry.atv')::uuid);
 view:=agape.ballot_view(v);
 if jsonb_array_length(view->'me'->'votes')<>1 or view::text like '%Clear, moving%' then raise exception 'Another voter''s votes are visible'; end if;
 begin
  perform 1 from agape.ballot_vote limit 1;
  raise exception 'Direct vote table access allowed';
 exception when insufficient_privilege then null; end;
end $$;

-- Eligibility: sibling-topic creators vote at the shared ancestor only; expired and non-creators cannot vote.
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000004',true);
do $$ declare v uuid:=current_setting('vote.video')::uuid; t uuid:=current_setting('vote.tv')::uuid; begin
 begin
  perform agape.cast_vote(v,current_setting('entry.bb')::uuid);
  raise exception 'Creator outside the ballot topic voted';
 exception when insufficient_privilege then null; end;
 perform agape.cast_vote(t,current_setting('entry.btv')::uuid);
end $$;
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000006',true);
do $$ declare v uuid:=current_setting('vote.video')::uuid; begin
 begin
  perform agape.cast_vote(v,current_setting('entry.bb')::uuid);
  raise exception 'Expired verification voted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000005',true);
do $$ declare v uuid:=current_setting('vote.video')::uuid; begin
 if (agape.my_voting_budget()->>'earned')::numeric<>0 then raise exception 'Member without contributions has a budget'; end if;
 begin
  perform agape.cast_vote(v,current_setting('entry.bb')::uuid);
  raise exception 'Non-creator voted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from agape.ballot_vote where voter_id='af000000-0000-4000-8000-000000000004' and basis_video_id='votevideocc') then raise exception 'Eligibility basis not recorded'; end if;
end $$;

-- Sealed until close, even for administrators; then results and audit become available.
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare v uuid:=current_setting('vote.video')::uuid; t uuid:=current_setting('vote.tv')::uuid; results jsonb; begin
 if agape.ballot_view(v)->'results'<>'null'::jsonb then raise exception 'Results visible while open'; end if;
 begin
  perform agape.ballot_audit(v);
  raise exception 'Audit available while open';
 exception when insufficient_privilege then null; end;
 perform agape.close_ballot(v);
 perform agape.close_ballot(t);
 begin
  perform agape.close_ballot(v);
  raise exception 'Ballot closed twice';
 exception when serialization_failure then null; end;
 results:=agape.ballot_view(v)->'results';
 if (results->>'voters')::int<>2 or (results->>'provisional')::boolean or jsonb_array_length(results->'board')<>2
  or exists(select 1 from jsonb_array_elements(results->'board') r where (r->>'rank')::int<>1 or (r->>'points')::int<>1) then
  raise exception 'Video results incorrect: %',results; end if;
 if results::text not like '%well sourced%' or results::text like '%af000000-0000-4000-8000-00000000000%' then raise exception 'Explanations missing or voters exposed'; end if;
 if not (agape.ballot_view(t)->'results'->>'provisional')::boolean then raise exception 'Two-work ballot not provisional'; end if;
 if jsonb_array_length(agape.ballot_audit(v))<>2 or agape.ballot_audit(v)::text not like '%a@vote.test%' then raise exception 'Audit incomplete'; end if;
end $$;
select set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
do $$ declare v uuid:=current_setting('vote.video')::uuid; begin
 begin
  perform agape.cast_vote(v,current_setting('entry.bb')::uuid);
  raise exception 'Vote accepted after close';
 exception when serialization_failure then null; end;
 if (agape.my_voting_budget()->>'committed')::numeric<>0 then raise exception 'Closed ballot points not released'; end if;
 begin
  perform agape.ballot_audit(v);
  raise exception 'Non-admin audit allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The board shows the top 10 by points.
insert into agape.channels(channel_id,user_id,title) values('vote-bulk','af000000-0000-4000-8000-000000000005','Bulk');
insert into agape.videos(video_id,channel_id,title,youtube_category_id,duration_seconds)
select 'bulkvideo'||lpad(i::text,2,'0'),'vote-bulk','Bulk '||i,'10',60 from generate_series(1,12) i;
insert into auth.users(id) select ('af000000-0000-4000-8000-1000000000'||lpad(i::text,2,'0'))::uuid from generate_series(1,12) i;
insert into agape.ballot(id,kind,node_id,title,closes_at) values('af000000-0000-4000-8000-000000000050','video','af000000-0000-4000-8000-000000000011','Bulk',now()+interval '1 day');
insert into agape.ballot_entry(ballot_id,video_id,position)
select 'af000000-0000-4000-8000-000000000050','bulkvideo'||lpad(i::text,2,'0'),i from generate_series(1,12) i;
insert into agape.ballot_vote(entry_id,voter_id,ballot_id)
select e.id,('af000000-0000-4000-8000-1000000000'||lpad(n::text,2,'0'))::uuid,e.ballot_id
from agape.ballot_entry e cross join generate_series(1,12) n where e.ballot_id='af000000-0000-4000-8000-000000000050' and n<=e.position;
update agape.ballot set closes_at=clock_timestamp() where id='af000000-0000-4000-8000-000000000050';
do $$ declare board jsonb:=agape.ballot_results('af000000-0000-4000-8000-000000000050')->'board'; begin
 if jsonb_array_length(board)<>10 or (board->0->>'points')::int<>12 or (board->9->>'points')::int<>3 then raise exception 'Top-10 board incorrect: %',board; end if;
end $$;
