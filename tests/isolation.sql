begin;
create function pg_temp.assert(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',msg; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$
declare failed boolean:=false;
begin
  begin execute statement; exception when others then failed:=true; end;
  if not failed then raise exception 'Expected statement to be denied: %',statement; end if;
end $$;
insert into auth.users values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('10000000-0000-0000-0000-000000000002','other@test.invalid'),
 ('10000000-0000-0000-0000-000000000003','admin@test.invalid');
insert into agape.members values('10000000-0000-0000-0000-000000000003','admin');
insert into agape.ontology_node(node_id,parent_id,slug) values
 ('20000000-0000-0000-0000-000000000001',null,'science'),
 ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','biology'),
 ('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','physics'),
 ('20000000-0000-0000-0000-000000000004',null,'music');
insert into agape.node_name select node_id,'en',slug,'' from agape.ontology_node;
insert into agape.node_name values('20000000-0000-0000-0000-000000000001','fr','Sciences','');
-- Same ID and title in Allways cannot be returned by Agape's search.
create table public.ontology_node(node_id uuid primary key,name text);
insert into public.ontology_node values('20000000-0000-0000-0000-000000000001','ALLWAYS_ONLY'),
 ('90000000-0000-0000-0000-000000000001','ALLWAYS_ONLY');
grant select on public.ontology_node to anon,authenticated;
select pg_temp.denied($q$insert into agape.ontology_edge values('20000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','related',0)$q$);
select pg_temp.denied($q$update agape.ontology_node set parent_id='20000000-0000-0000-0000-000000000002' where node_id='20000000-0000-0000-0000-000000000001'$q$);
insert into agape.channels(channel_id,user_id,title) values
 ('owner','10000000-0000-0000-0000-000000000001','Owner'),('other','10000000-0000-0000-0000-000000000002','Other');
insert into agape.videos(video_id,channel_id,title,youtube_category_id,duration_seconds) values
 ('aaaaaaaaaaa','owner','Biology video','27',120),('bbbbbbbbbbb','other','Physics video','27',120),('ccccccccccc','other','Music video','10',120);
insert into agape.video_topics values
 ('aaaaaaaaaaa','20000000-0000-0000-0000-000000000002','approved'),
 ('bbbbbbbbbbb','20000000-0000-0000-0000-000000000003','approved'),
 ('ccccccccccc','20000000-0000-0000-0000-000000000004','approved');
insert into agape.tag_kind values('medium','Medium');
insert into agape.tag(tag_id,kind,code) values('30000000-0000-0000-0000-000000000001','medium','lecture');
insert into agape.node_tag values('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');

set local role anon;
select pg_temp.assert(jsonb_array_length(agape.browse(null,'en','ALLWAYS_ONLY')->'topics')=0,'Search leaked Allways');
select pg_temp.assert(jsonb_array_length(agape.browse()->'topics')=2,'Independent roots');
select pg_temp.assert(agape.browse('20000000-0000-0000-0000-000000000001','fr')->'node'->>'name'='Sciences','Localized label');
select pg_temp.assert(agape.browse('20000000-0000-0000-0000-000000000002','fr')->'node'->>'name'='biology','English fallback');
select pg_temp.assert(jsonb_array_length(agape.browse('20000000-0000-0000-0000-000000000002')->'breadcrumbs')=2,'Canonical breadcrumbs');
select pg_temp.assert(jsonb_array_length(agape.browse('20000000-0000-0000-0000-000000000001')->'videos')=2,'Subtree video listing');
select pg_temp.assert(jsonb_array_length(agape.browse('20000000-0000-0000-0000-000000000001','en','',null,false)->'videos')=0,'Direct video listing');
select pg_temp.assert((select count(*)=3 from agape.node_tag_effective),'Inherited tags');
select pg_temp.assert(not agape.can_comment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001'),'Anonymous eligibility');
select pg_temp.denied($q$insert into agape.ontology_node(slug) values('unauthorized')$q$);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert(agape.can_comment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001'),'Creator in sibling subtopic qualifies under common parent');
select pg_temp.assert(not agape.can_comment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000003'),'Creator outside exact child does not qualify');
select pg_temp.assert(not agape.can_comment('ccccccccccc','20000000-0000-0000-0000-000000000001'),'Target outside selected subtree');
insert into agape.comments(video_id,node_id,user_id,body) values('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A useful explanation.');
select pg_temp.denied($q$insert into agape.comments(video_id,node_id,user_id,body) values('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Spoofed')$q$);
select pg_temp.denied($q$insert into agape.video_topics values('aaaaaaaaaaa','20000000-0000-0000-0000-000000000004','approved')$q$);
select pg_temp.denied($q$select agape.create_topic(null,'Unauthorized','')$q$);
select pg_temp.denied($q$select agape.record_verified_video('10000000-0000-0000-0000-000000000001','owner','Owner','ddddddddddd','Forged video','27',120,'20000000-0000-0000-0000-000000000002')$q$);
select pg_temp.denied($q$select agape.submit_fragment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000003','Not mine',0,20)$q$);
select pg_temp.denied($q$select agape.submit_fragment('aaaaaaaaaaa','20000000-0000-0000-0000-000000000002','Too long',0,121)$q$);
select agape.submit_fragment('aaaaaaaaaaa','20000000-0000-0000-0000-000000000002','Introduction',5,20);
select pg_temp.assert(jsonb_array_length(agape.browse('20000000-0000-0000-0000-000000000001')->'fragments')=1,'Clip is visible in parent TV');
select pg_temp.denied($q$insert into agape.subtitle_cues(video_id,locale,start_seconds,end_seconds,markdown) values('bbbbbbbbbbb','en',0,5,'Not mine')$q$);
insert into agape.subtitle_cues(video_id,locale,start_seconds,end_seconds,markdown) values('aaaaaaaaaaa','en',0,5,'**Hello**');
reset role;
update agape.video_topics set status='pending' where video_id='aaaaaaaaaaa';
set local role authenticated;
select pg_temp.assert(not agape.can_comment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001'),'Unapproved classification cannot grant rights');
reset role;
update agape.video_topics set status='approved' where video_id='aaaaaaaaaaa';
update agape.videos set verified_at=now()-interval '31 days' where video_id='aaaaaaaaaaa';
set local role authenticated;
select pg_temp.assert(not agape.can_comment('bbbbbbbbbbb','20000000-0000-0000-0000-000000000001'),'Expired verification cannot grant rights');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select agape.create_topic(null,'Independent root','Agape only');
reset role;
set local role service_role;
select agape.record_verified_video('10000000-0000-0000-0000-000000000001','owner','Owner','ddddddddddd','Verified import','27',120,'20000000-0000-0000-0000-000000000002');
select pg_temp.assert((select status='pending' from agape.video_topics where video_id='ddddddddddd'),'Verified import still requires topic approval');
select pg_temp.denied($q$select agape.record_verified_video('10000000-0000-0000-0000-000000000002','owner','Hijack','eeeeeeeeeee','Hijack video','27',120,'20000000-0000-0000-0000-000000000002')$q$);
select pg_temp.assert(not exists(select 1 from agape.videos where video_id='eeeeeeeeeee'),'Conflicting ownership rolls back import');
do $$ begin
  for i in 1..10 loop
    perform pg_temp.assert(agape.consume_verification('10000000-0000-0000-0000-000000000001'),'Verification budget unexpectedly exhausted');
  end loop;
  perform pg_temp.assert(not agape.consume_verification('10000000-0000-0000-0000-000000000001'),'Verification budget exceeded');
end $$;
reset role;
select pg_temp.assert((select count(*)=2 from public.ontology_node),'Allways unchanged');
select pg_temp.assert(not exists(
  select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  join pg_class r on r.oid=c.confrelid join pg_namespace rn on rn.oid=r.relnamespace
  where c.contype='f' and n.nspname='agape' and rn.nspname not in ('agape','auth')
),'Cross-schema foreign keys');
rollback;
