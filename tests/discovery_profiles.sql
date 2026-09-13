-- Discovery slots and public creator profiles. Self-contained; caller always rolls this transaction back.
insert into auth.users(id,email) values
 ('c0000000-0000-4000-8000-000000000001','a@discover.test'),('c0000000-0000-4000-8000-000000000002','b@discover.test'),
 ('c0000000-0000-4000-8000-000000000003','c@discover.test'),('c0000000-0000-4000-8000-000000000004','pending@discover.test'),
 ('c0000000-0000-4000-8000-000000000005','recognized@discover.test'),('c0000000-0000-4000-8000-000000000006','elsewhere@discover.test');
insert into agape.ontology_node(node_id,slug,status) values
 ('c0000000-0000-4000-8000-000000000010','discover-topic','published'),('c0000000-0000-4000-8000-000000000011','discover-elsewhere','published');
insert into agape.node_name(node_id,locale,name) values('c0000000-0000-4000-8000-000000000010','en','Discover topic');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000001','discover-a','A channel','discovervaa','A video','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000002','discover-b','B channel','discovervb1','B first','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000002','discover-b','B channel','discovervb2','B second','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000003','discover-c','C channel','discovervcc','C video','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000004','discover-d','Pending channel','discovervdd','Pending video','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000005','discover-e','Recognized channel','discoverver','Recognized video','10',60,'c0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('c0000000-0000-4000-8000-000000000006','discover-f','Elsewhere channel','discovervff','Elsewhere video','10',60,'c0000000-0000-4000-8000-000000000011');
update agape.video_topics set status='approved' where video_id in('discovervaa','discovervb1','discovervb2','discovervcc','discoverver','discovervff');
-- The recognized creator's video received a point on a closed ballot; A's entry received none.
insert into agape.ballot(id,kind,node_id,title,closes_at) values('c0000000-0000-4000-8000-000000000020','video','c0000000-0000-4000-8000-000000000010','Closed ballot',now()+interval '1 day');
insert into agape.ballot_entry(id,ballot_id,video_id,owner_id,position) values
 ('c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000020','discoverver','c0000000-0000-4000-8000-000000000005',1),
 ('c0000000-0000-4000-8000-000000000022','c0000000-0000-4000-8000-000000000020','discovervaa','c0000000-0000-4000-8000-000000000001',2);
insert into agape.ballot_vote(entry_id,voter_id,ballot_id) values('c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000020');
update agape.ballot set closes_at=clock_timestamp() where id='c0000000-0000-4000-8000-000000000020';
-- An open ballot's votes do not count toward profile results yet.
insert into agape.ballot(id,kind,node_id,title,closes_at) values('c0000000-0000-4000-8000-000000000030','video','c0000000-0000-4000-8000-000000000010','Open ballot',now()+interval '1 day');
insert into agape.ballot_entry(id,ballot_id,video_id,owner_id,position) values('c0000000-0000-4000-8000-000000000031','c0000000-0000-4000-8000-000000000030','discoverver','c0000000-0000-4000-8000-000000000005',1);
insert into agape.ballot_vote(entry_id,voter_id,ballot_id) values('c0000000-0000-4000-8000-000000000031','c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000030');
insert into agape.tv_program(id,node_id,owner_id,title) values('c0000000-0000-4000-8000-000000000040','c0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-000000000001','A TV');
insert into agape.tv_edition(id,program_id,title,revision,fragments,tracks,published_by) values('c0000000-0000-4000-8000-000000000041','c0000000-0000-4000-8000-000000000040','A TV',1,'[]','[]','c0000000-0000-4000-8000-000000000001');

set local role anon;
do $$ declare picks jsonb; ids text[]; begin
 for i in 1..25 loop
  picks:=agape.discover_videos('c0000000-0000-4000-8000-000000000010',3);
  select array_agg(p->>'video_id') into ids from jsonb_array_elements(picks) p;
  if jsonb_array_length(picks)<>3 then raise exception 'Expected three discovery slots: %',picks; end if;
  if 'discoverver'=any(ids) then raise exception 'Recognized video shown while unrecognized creators remain'; end if;
  if 'discovervb1'=any(ids) and 'discovervb2'=any(ids) then raise exception 'Two videos from one creator'; end if;
  if 'discovervdd'=any(ids) or 'discovervff'=any(ids) then raise exception 'Unapproved or out-of-topic video shown'; end if;
 end loop;
 picks:=agape.discover_videos('c0000000-0000-4000-8000-000000000010',100);
 if jsonb_array_length(picks)<>4 or picks->3->>'video_id'<>'discoverver' then raise exception 'Clamped discovery or recognized ordering incorrect: %',picks; end if;
 if jsonb_array_length(agape.discover_videos('c0000000-0000-4000-8000-000000000010',0))<>1 then raise exception 'Minimum limit not applied'; end if;
 picks:=agape.discover_videos(null,6);
 if jsonb_array_length(picks) not between 1 and 6 then raise exception 'All-topic discovery incorrect: %',picks; end if;
 if agape.discover_videos(null,6)::text like '%@discover.test%' then raise exception 'Discovery exposed an email'; end if;

 if agape.creator_profile('c0000000-0000-4000-8000-000000000004') is not null then raise exception 'Profile shown without an approved placement'; end if;
 if agape.creator_profile('c0000000-0000-4000-8000-000000000005')::text like '%@%' then raise exception 'Profile exposed an email'; end if;
 if jsonb_array_length(agape.creator_profile('c0000000-0000-4000-8000-000000000005')->'ballot_results')<>1
  or (agape.creator_profile('c0000000-0000-4000-8000-000000000005')->'ballot_results'->0->>'rank')::int<>1
  or (agape.creator_profile('c0000000-0000-4000-8000-000000000005')->'ballot_results'->0->>'points')::int<>1 then raise exception 'Closed ballot result missing or open ballot counted'; end if;
 if jsonb_array_length(agape.creator_profile('c0000000-0000-4000-8000-000000000001')->'ballot_results')<>0 then raise exception 'Unrecommended work listed as a result'; end if;
 if jsonb_array_length(agape.creator_profile('c0000000-0000-4000-8000-000000000001')->'tvs')<>1
  or agape.creator_profile('c0000000-0000-4000-8000-000000000001')->'tvs'->0->'latest_edition'->>'id' is null then raise exception 'Profile TVs incorrect'; end if;
 if jsonb_array_length(agape.creator_profile('c0000000-0000-4000-8000-000000000002')->'videos')<>2
  or agape.creator_profile('c0000000-0000-4000-8000-000000000002')->'videos'->0->'topics'->0->>'name'<>'Discover topic' then raise exception 'Profile videos incorrect'; end if;
 if agape.video_detail('discoverver','c0000000-0000-4000-8000-000000000010','en')->>'creator_id'<>'c0000000-0000-4000-8000-000000000005' then raise exception 'video_detail creator_id missing'; end if;
end $$;
reset role;
