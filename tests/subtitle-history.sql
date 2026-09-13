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
