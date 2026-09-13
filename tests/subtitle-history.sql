-- Self-contained fixtures; caller always rolls this transaction back.
insert into auth.users(id) values('ac000000-0000-4000-8000-000000000001'),('ac000000-0000-4000-8000-000000000002');
insert into agape.ontology_node(node_id,slug) values('ac000000-0000-4000-8000-000000000003','subtitle-history-test');
insert into agape.curated_tv_fragment(id,node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds)
values('ac000000-0000-4000-8000-000000000004','ac000000-0000-4000-8000-000000000003','test','aaaaaaaaaaa','Test','Test',120,30,75);
insert into agape.channels(channel_id,user_id,title) values('history-test','ac000000-0000-4000-8000-000000000001','Test');
insert into agape.videos(video_id,channel_id,title,youtube_category_id,duration_seconds) values('historytest','history-test','Test','27',120);
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into agape.tv_subtitle_cue(id,fragment_id,locale,start_seconds,end_seconds,markdown)
values('ac000000-0000-4000-8000-000000000005','ac000000-0000-4000-8000-000000000004','en',30,35,'Original');
insert into agape.subtitle_cues(id,video_id,locale,start_seconds,end_seconds,markdown)
values('ac000000-0000-4000-8000-000000000006','historytest','en',1,5,'Creator original');
select agape.save_subtitle('curated','ac000000-0000-4000-8000-000000000005',1,31,36,'Edited');
do $$ begin
 begin
  perform agape.save_subtitle('curated','ac000000-0000-4000-8000-000000000005',1,30,35,'Stale');
  raise exception 'Stale edit accepted';
 exception when serialization_failure then null; end;
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and revision=2 and markdown='Edited') then raise exception 'Stale edit damaged current version'; end if;
 begin
  delete from agape.subtitle_history;
  raise exception 'History mutation allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
do $$ declare original bigint; begin
 select id into strict original from agape.subtitle_history_list('curated','ac000000-0000-4000-8000-000000000004','version1','en') where revision=1;
 perform agape.restore_subtitle(original,2);
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and revision=3 and markdown='Original' and start_seconds=30 and user_id=auth.uid()) then raise exception 'Shared restore failed'; end if;
 perform agape.save_subtitle('curated','ac000000-0000-4000-8000-000000000005',3,30,35,'',true);
 perform agape.restore_subtitle(original,4);
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and revision=5 and markdown='Original') then raise exception 'Deleted cue restore failed'; end if;
 begin
  perform agape.restore_subtitle(original,4);
  raise exception 'Stale restore accepted';
 exception when serialization_failure then null; end;
 if (select count(*) from agape.subtitle_history_list('curated','ac000000-0000-4000-8000-000000000004','version1','en'))<>5 then raise exception 'History incomplete'; end if;
 if exists(select 1 from agape.subtitle_history_list('curated','ac000000-0000-4000-8000-000000000004','version2','en')) then raise exception 'Track histories intersect'; end if;
 begin
  perform agape.subtitle_history_list('creator','historytest','version1','en');
  raise exception 'Other creator history exposed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Knowing a history ID cannot bypass creator ownership.
select set_config('history.test.id',(select id::text from agape.subtitle_history where cue_id='ac000000-0000-4000-8000-000000000006'),true);
set local role authenticated;
do $$ begin
 begin
  perform agape.restore_subtitle(current_setting('history.test.id')::bigint,1);
  raise exception 'Other creator restore allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
select agape.save_subtitle('creator','ac000000-0000-4000-8000-000000000006',1,2,6,'Creator edited');
select agape.restore_subtitle(current_setting('history.test.id')::bigint,2);
do $$ begin
 if not exists(select 1 from agape.subtitle_cues where id='ac000000-0000-4000-8000-000000000006' and revision=3 and markdown='Creator original') then raise exception 'Creator restore failed'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform agape.subtitle_history_list('curated','ac000000-0000-4000-8000-000000000004','version1','en');
  raise exception 'Anonymous history access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A failed multi-cue publish must not leave earlier edits applied.
set local role authenticated;
do $$ begin
 begin
  perform agape.publish_subtitles('curated','ac000000-0000-4000-8000-000000000004','version1','en', '[
   {"operation":"update","id":"ac000000-0000-4000-8000-000000000005","expected":5,"start_seconds":30,"end_seconds":35,"markdown":"Must roll back"},
   {"operation":"update","id":"ac000000-0000-4000-8000-000000000005","expected":1,"start_seconds":30,"end_seconds":35,"markdown":"Stale"}
  ]');
  raise exception 'Conflicting batch accepted';
 exception when serialization_failure then null; end;
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and revision=5 and markdown='Original') then raise exception 'Batch was partially applied'; end if;
 perform agape.publish_subtitles('curated','ac000000-0000-4000-8000-000000000004','version1','en', '[
  {"operation":"update","id":"ac000000-0000-4000-8000-000000000005","expected":5,"start_seconds":30,"end_seconds":35,"markdown":"Batch updated"},
  {"operation":"insert","id":"ac000000-0000-4000-8000-000000000007","start_seconds":35,"end_seconds":40,"markdown":"Batch added"}
 ]');
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and revision=6 and markdown='Batch updated') or not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000007' and revision=1) then raise exception 'Atomic publish failed'; end if;
 begin
  perform agape.publish_subtitles('curated','ac000000-0000-4000-8000-000000000004','version2','en', '[{"operation":"delete","id":"ac000000-0000-4000-8000-000000000007","expected":1}]');
  raise exception 'Cross-track batch accepted';
 exception when serialization_failure then null; end;
end $$;
reset role;
-- TV selection captions are independent of source captions, with whole-track revisions.
set local role authenticated;
select agape.save_tv_track('ac000000-0000-4000-8000-000000000003','version1','en',0,'[{"id":"ac000000-0000-4000-8000-000000000008","section_id":"ac000000-0000-4000-8000-000000000004","start_seconds":30,"end_seconds":36,"markdown":"TV edition"}]');
do $$ begin
 if not exists(select 1 from agape.tv_subtitle_cue where id='ac000000-0000-4000-8000-000000000005' and markdown='Batch updated') then raise exception 'TV changed source captions'; end if;
 begin
  perform agape.save_tv_track('ac000000-0000-4000-8000-000000000003','version1','en',0,'[]');
  raise exception 'Stale TV edition accepted';
 exception when serialization_failure then null; end;
 begin
  perform agape.save_tv_order('ac000000-0000-4000-8000-000000000003',0,array['ac000000-0000-4000-8000-000000000004'::uuid]);
  raise exception 'Non-admin reorder accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.add_tv_section('ac000000-0000-4000-8000-000000000003','bbbbbbbbbbb','New','Channel',60,0,30);
  raise exception 'Non-admin section insertion accepted';
 exception when insufficient_privilege then null; end;
 if (select count(*) from agape.tv_selection_history where selection_key='ac000000-0000-4000-8000-000000000003')<>1 then raise exception 'TV history missing'; end if;
end $$;
reset role;
insert into agape.members(user_id,role) values('ac000000-0000-4000-8000-000000000001','admin');
set local role authenticated;
do $$ declare new_section uuid; program jsonb; begin
 new_section:=agape.add_tv_section('ac000000-0000-4000-8000-000000000003','bbbbbbbbbbb','New section','Channel',60,0,30);
 perform agape.save_tv_order('ac000000-0000-4000-8000-000000000003',0,array[new_section,'ac000000-0000-4000-8000-000000000004'::uuid]);
 program:=agape.tv_browse('ac000000-0000-4000-8000-000000000003','en');
 if program->'fragments'->0->>'id'<>new_section::text then raise exception 'TV order not applied'; end if;
 if not exists(select 1 from agape.tv_selection_track where selection_key='ac000000-0000-4000-8000-000000000003' and cues->0->>'section_id'='ac000000-0000-4000-8000-000000000004' and (cues->0->>'start_seconds')::numeric=30) then raise exception 'Reorder detached subtitles'; end if;
end $$;
set local role anon;
do $$ begin
 if not exists(select 1 from agape.tv_selection_track where selection_key='ac000000-0000-4000-8000-000000000003' and revision=1) then raise exception 'TV edition is not publicly readable'; end if;
 begin
  perform agape.save_tv_track('ac000000-0000-4000-8000-000000000003','version1','en',1,'[]');
  raise exception 'Anonymous TV publish allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Trimming only changes this selection, never the original fragment.
set local role authenticated;
select agape.trim_tv_section('ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000004',30,75,32,60);
do $$ declare f jsonb; denied boolean:=false; begin
 select value into f from jsonb_array_elements(agape.tv_browse('ac000000-0000-4000-8000-000000000003','en')->'fragments') where value->>'id'='ac000000-0000-4000-8000-000000000004';
 if (f->>'start_seconds')::integer<>32 or (f->>'end_seconds')::integer<>60 then raise exception 'Trim not applied'; end if;
 if not exists(select 1 from agape.curated_tv_fragment where id='ac000000-0000-4000-8000-000000000004' and start_seconds=30 and end_seconds=75) then raise exception 'Trim changed source fragment'; end if;
 begin
  perform agape.trim_tv_section('ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000004',32,60,0,121);
 exception when others then denied:=true; end;
 if not denied then raise exception 'Out-of-video trim accepted'; end if;
 begin
  perform agape.trim_tv_section('ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000004',30,75,0,30);
  raise exception 'Stale trim accepted';
 exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform agape.trim_tv_section('ac000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000004',32,60,0,30);
  raise exception 'Non-admin trim accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Without a program row, even a site administrator gets an explicit error rather than a partial save.
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare original jsonb; begin
 original:=agape.tv_browse('ac000000-0000-4000-8000-000000000003','en')->'fragments';
 begin
  perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003',original,original,'Unowned');
  raise exception 'Layout saved without a TV program';
 exception when no_data_found then null; end;
 begin
  perform agape.tv_edition_preview('ac000000-0000-4000-8000-000000000003');
  raise exception 'Edition preview without a TV program';
 exception when no_data_found then null; end;
end $$;
reset role;
-- A TV owner needs no site-wide role. Layout saves are atomic; editions immutable.
delete from agape.members where user_id='ac000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 if agape.can_claim_tv('ac000000-0000-4000-8000-000000000003') then raise exception 'Creator without an approved video may claim'; end if;
 begin
  perform agape.claim_tv_program('ac000000-0000-4000-8000-000000000003','Not mine');
  raise exception 'Ineligible TV claim accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into agape.video_topics(video_id,node_id,status) values('historytest','ac000000-0000-4000-8000-000000000003','approved');
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 begin
  perform agape.claim_tv_program(null,'Root TV');
  raise exception 'Non-admin root TV claim accepted';
 exception when insufficient_privilege then null; end;
 if not agape.can_claim_tv('ac000000-0000-4000-8000-000000000003') then raise exception 'Eligible creator cannot claim'; end if;
 perform agape.claim_tv_program('ac000000-0000-4000-8000-000000000003','Named TV');
 begin
  perform agape.claim_tv_program('ac000000-0000-4000-8000-000000000003','Again');
  raise exception 'Second TV claim accepted';
 exception when unique_violation then null; end;
end $$;
do $$ declare original jsonb; changed jsonb; eid uuid; denied boolean:=false; fingerprint text; begin
 if agape.is_admin() or not agape.can_edit_tv('ac000000-0000-4000-8000-000000000003') then raise exception 'Owner permissions incorrect'; end if;
 original:=agape.tv_browse('ac000000-0000-4000-8000-000000000003','en')->'fragments';
 select jsonb_agg(value order by ordinality desc) into changed from jsonb_array_elements(original) with ordinality;
 perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003',original,changed,'My TV');
 eid:=agape.publish_tv_edition('ac000000-0000-4000-8000-000000000003',agape.tv_edition_preview('ac000000-0000-4000-8000-000000000003')->>'fingerprint');
 perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003',changed,original,'Next draft');
 if not exists(select 1 from agape.tv_edition where id=eid and title='My TV' and fragments=changed and jsonb_array_length(tracks)>0) then raise exception 'Edition changed with draft or lost captions'; end if;
 -- An edition freezes only what its owner reviewed.
 fingerprint:=agape.tv_edition_preview('ac000000-0000-4000-8000-000000000003')->>'fingerprint';
 perform agape.save_tv_track('ac000000-0000-4000-8000-000000000003','version2','en',0,'[]');
 begin
  perform agape.publish_tv_edition('ac000000-0000-4000-8000-000000000003',fingerprint);
  raise exception 'Edition published from a stale review';
 exception when serialization_failure then null; end;
 if (select count(*) from agape.tv_edition where selection_key='ac000000-0000-4000-8000-000000000003')<>1 then raise exception 'Stale publish created an edition'; end if;
 perform agape.publish_tv_edition('ac000000-0000-4000-8000-000000000003',agape.tv_edition_preview('ac000000-0000-4000-8000-000000000003')->>'fingerprint');
 begin
  perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003',changed,original,'Stale');
  raise exception 'Stale layout accepted';
 exception when serialization_failure then null; end;
 begin
  perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003',original,jsonb_set(changed,'{0,end_seconds}','999999'),'Bad');
 exception when others then denied:=true; end;
 if not denied or agape.tv_browse('ac000000-0000-4000-8000-000000000003','en')->'fragments'<>original then raise exception 'Invalid save was not atomic'; end if;
 begin
  update agape.tv_edition set title='Tampered' where id=eid;
  raise exception 'Edition mutation allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform agape.save_tv_layout('ac000000-0000-4000-8000-000000000003','[]','[]','Other');
  raise exception 'Non-owner save allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
