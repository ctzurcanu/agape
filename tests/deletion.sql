-- Self-serve deletion removes a person's Agape data, keeps others' work, and never deletes the shared sign-in account.
-- Self-contained fixtures; caller always rolls this transaction back.
insert into auth.users(id,email) values
 ('b0000000-0000-4000-8000-000000000001','leaving@delete.test'),('b0000000-0000-4000-8000-000000000002','staying@delete.test'),
 ('b0000000-0000-4000-8000-000000000003','admin@delete.test');
insert into agape.members(user_id,role) values('b0000000-0000-4000-8000-000000000001','admin');
insert into agape.ontology_node(node_id,slug,status) values('b0000000-0000-4000-8000-000000000010','delete-topic','published');
insert into agape.node_name(node_id,locale,name) values('b0000000-0000-4000-8000-000000000010','en','Delete topic');
insert into agape.curated_tv_fragment(id,node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds)
values('b0000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000010','test','deletecur01','Curated','Test',120,30,75);
-- Fixtures written "by" the leaving user record them as history editor.
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
select agape.record_verified_video('b0000000-0000-4000-8000-000000000001','delete-x','Leaving channel','deletevidx1','Leaving video','10',120,'b0000000-0000-4000-8000-000000000010');
select agape.record_verified_video('b0000000-0000-4000-8000-000000000002','delete-y','Staying channel','deletevidy1','Staying video','10',120,'b0000000-0000-4000-8000-000000000010');
update agape.video_topics set status='approved';
insert into agape.fragments(id,video_id,title,start_seconds,end_seconds) values('b0000000-0000-4000-8000-000000000021','deletevidx1','Leaving moment',0,30);
insert into agape.fragment_topics values('b0000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000010','approved');
insert into agape.subtitle_cues(id,video_id,locale,start_seconds,end_seconds,markdown) values('b0000000-0000-4000-8000-000000000022','deletevidx1','en',1,2,'Leaving caption');
insert into agape.tv_subtitle_cue(id,fragment_id,user_id,locale,start_seconds,end_seconds,markdown)
values('b0000000-0000-4000-8000-000000000023','b0000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000001','en',30,35,'Shared line');
insert into agape.comments(video_id,node_id,user_id,body) values
 ('deletevidy1','b0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000001','Leaving comment'),
 ('deletevidx1','b0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000002','Comment on leaving video'),
 ('deletevidy1','b0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000002','Staying comment');
insert into agape.node_proposal(id,parent_id,name,proposed_by) values('b0000000-0000-4000-8000-000000000024','b0000000-0000-4000-8000-000000000010','Leaving idea','b0000000-0000-4000-8000-000000000001');
-- The leaving user's own TV, and the staying user's TV that includes the leaving user's moment and edition.
insert into agape.tv_program(id,node_id,owner_id,title) values
 ('b0000000-0000-4000-8000-000000000030','b0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000001','Leaving TV'),
 ('b0000000-0000-4000-8000-000000000031','b0000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000002','Staying TV');
insert into agape.tv_program_item(program_id,curated_fragment_id,fragment_id,position,start_seconds,end_seconds) values
 ('b0000000-0000-4000-8000-000000000030','b0000000-0000-4000-8000-000000000020',null,1,30,75),
 ('b0000000-0000-4000-8000-000000000031',null,'b0000000-0000-4000-8000-000000000021',1,0,30),
 ('b0000000-0000-4000-8000-000000000031','b0000000-0000-4000-8000-000000000020',null,2,30,75);
insert into agape.tv_edition(id,program_id,title,revision,fragments,tracks,published_by) values
 ('b0000000-0000-4000-8000-000000000040','b0000000-0000-4000-8000-000000000030','Leaving TV',1,'[]','[]','b0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000041','b0000000-0000-4000-8000-000000000031','Staying TV',1,'[]','[]','b0000000-0000-4000-8000-000000000001');
insert into agape.tv_program_track values
 ('b0000000-0000-4000-8000-000000000030','version1','en',1,'[]'),('b0000000-0000-4000-8000-000000000031','version1','en',1,'[]');
insert into agape.tv_program_history(program_id,track,locale,revision,cues,editor) values
 ('b0000000-0000-4000-8000-000000000030','version1','en',1,'[]','b0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000031','version1','en',1,'[]','b0000000-0000-4000-8000-000000000001');
-- Ballot, votes, fines, decisions, and configuration touched by the leaving user.
insert into agape.ballot(id,kind,node_id,title,closes_at,created_by) values('b0000000-0000-4000-8000-000000000050','video','b0000000-0000-4000-8000-000000000010','Delete ballot',now()+interval '1 day','b0000000-0000-4000-8000-000000000001');
insert into agape.ballot_entry(id,ballot_id,video_id,owner_id,position) values
 ('b0000000-0000-4000-8000-000000000051','b0000000-0000-4000-8000-000000000050','deletevidx1','b0000000-0000-4000-8000-000000000001',1),
 ('b0000000-0000-4000-8000-000000000052','b0000000-0000-4000-8000-000000000050','deletevidy1','b0000000-0000-4000-8000-000000000002',2);
insert into agape.ballot_vote(entry_id,voter_id,ballot_id,basis_video_id) values
 ('b0000000-0000-4000-8000-000000000052','b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000050','deletevidx1'),
 ('b0000000-0000-4000-8000-000000000051','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000050','deletevidy1');
insert into agape.voting_fine(id,user_id,reason,imposed_by) values
 ('b0000000-0000-4000-8000-000000000060','b0000000-0000-4000-8000-000000000001','Leaving fine','b0000000-0000-4000-8000-000000000003'),
 ('b0000000-0000-4000-8000-000000000061','b0000000-0000-4000-8000-000000000002','Staying fine','b0000000-0000-4000-8000-000000000001');
insert into agape.moderation_decision(kind,video_id,node_id,decision,decided_by) values('video','deletevidy1','b0000000-0000-4000-8000-000000000010','approved','b0000000-0000-4000-8000-000000000001');
insert into agape.verification_budget(user_id) values('b0000000-0000-4000-8000-000000000001');
insert into agape.voting_budget_config(a,b,c,z,effective_at,created_by) values(3,1,0.25,1,now()+interval '100 years','b0000000-0000-4000-8000-000000000001');

set local role anon;
do $$ begin
 begin
  perform agape.delete_my_agape_data('DELETE MY AGAPE DATA');
  raise exception 'Anonymous deletion allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$ begin
 begin
  perform agape.delete_my_agape_data('delete');
  raise exception 'Deletion without exact confirmation accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform agape.delete_my_agape_data('DELETE MY AGAPE DATA');
  raise exception 'Sole administrator deleted';
 exception when object_not_in_prerequisite_state then null; end;
 if not exists(select 1 from agape.channels where channel_id='delete-x') then raise exception 'Refused deletion removed data'; end if;
end $$;
reset role;
insert into agape.members(user_id,role) values('b0000000-0000-4000-8000-000000000003','admin');
set local role authenticated;
select set_config('delete.result',agape.delete_my_agape_data('DELETE MY AGAPE DATA')::text,true);
reset role;

do $$ declare r record; n bigint; counts jsonb:=current_setting('delete.result')::jsonb; begin
 -- No Agape column still points at the person, including tables added later.
 for r in select c.conrelid::regclass::text as tbl,a.attname as col from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.contype='f' and c.confrelid='auth.users'::regclass and c.connamespace='agape'::regnamespace loop
  execute format('select count(*) from %s where %I=$1',r.tbl,r.col) into n using 'b0000000-0000-4000-8000-000000000001'::uuid;
  if n>0 then raise exception 'Agape data still references the deleted user: %.% (% rows)',r.tbl,r.col,n; end if;
 end loop;
 if not exists(select 1 from auth.users where id='b0000000-0000-4000-8000-000000000001') then raise exception 'Shared sign-in account was deleted'; end if;
 if counts->>'channels'<>'1' or counts->>'videos'<>'1' or counts->>'comments'<>'1' or counts->>'tvs'<>'1' or counts->>'votes'<>'1'
  or counts->>'topic_suggestions'<>'1' or counts->>'fines'<>'1' or counts->>'anonymized_subtitles'<>'1' then raise exception 'Deletion counts incorrect: %',counts; end if;
 -- Removed with the person.
 if exists(select 1 from agape.videos where video_id='deletevidx1') or exists(select 1 from agape.fragments where id='b0000000-0000-4000-8000-000000000021')
  or exists(select 1 from agape.subtitle_history where snapshot->>'video_id'='deletevidx1') then raise exception 'Video data remains'; end if;
 if exists(select 1 from agape.tv_program where id='b0000000-0000-4000-8000-000000000030') or exists(select 1 from agape.tv_edition where id='b0000000-0000-4000-8000-000000000040') then raise exception 'Own TV remains'; end if;
 if exists(select 1 from agape.node_proposal where id='b0000000-0000-4000-8000-000000000024') or exists(select 1 from agape.ballot_entry where id='b0000000-0000-4000-8000-000000000051') then raise exception 'Proposal or ballot entry remains'; end if;
 if (agape.voting_earned('b0000000-0000-4000-8000-000000000001')->>'earned')::numeric<>0 then raise exception 'Deleted person still has a voting budget'; end if;
 -- Others' work stays; shared contributions lose their author.
 if not exists(select 1 from agape.videos where video_id='deletevidy1') or not exists(select 1 from agape.comments where body='Staying comment')
  or not exists(select 1 from agape.voting_fine where id='b0000000-0000-4000-8000-000000000061' and imposed_by is null) then raise exception 'Other creator data damaged'; end if;
 if not exists(select 1 from agape.tv_program where id='b0000000-0000-4000-8000-000000000031')
  or (select count(*) from agape.tv_program_item where program_id='b0000000-0000-4000-8000-000000000031')<>1
  or not exists(select 1 from agape.tv_edition where id='b0000000-0000-4000-8000-000000000041' and published_by is null)
  or not exists(select 1 from agape.tv_program_track where program_id='b0000000-0000-4000-8000-000000000031') then raise exception 'Other TV damaged'; end if;
 if not exists(select 1 from agape.tv_subtitle_cue where id='b0000000-0000-4000-8000-000000000023' and user_id is null and markdown='Shared line') then raise exception 'Shared subtitle not kept anonymously'; end if;
 if not exists(select 1 from agape.ballot where id='b0000000-0000-4000-8000-000000000050' and created_by is null)
  or not exists(select 1 from agape.ballot_entry where id='b0000000-0000-4000-8000-000000000052') then raise exception 'Ballot damaged'; end if;
 if not exists(select 1 from agape.members where user_id='b0000000-0000-4000-8000-000000000003' and role='admin') then raise exception 'Other administrator removed'; end if;
end $$;
