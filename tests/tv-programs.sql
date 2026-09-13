-- Named TVs: several per topic, each with its own excerpts, subtitles, and editions.
-- Self-contained fixtures; caller always rolls this transaction back.
insert into auth.users(id) values('ad000000-0000-4000-8000-000000000001'),('ad000000-0000-4000-8000-000000000002'),('ad000000-0000-4000-8000-000000000003');
insert into agape.members(user_id,role) values('ad000000-0000-4000-8000-000000000003','admin');
insert into agape.ontology_node(node_id,slug,status) values('ad000000-0000-4000-8000-000000000010','tv-programs-parent','published'),('ad000000-0000-4000-8000-000000000012','tv-programs-other','published');
insert into agape.ontology_node(node_id,parent_id,slug,status) values('ad000000-0000-4000-8000-000000000011','ad000000-0000-4000-8000-000000000010','tv-programs-child','published');
insert into agape.curated_tv_fragment(id,node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds,position) values
 ('ad000000-0000-4000-8000-000000000020','ad000000-0000-4000-8000-000000000011','test','tvprogram01','One','Test',120,30,75,1),
 ('ad000000-0000-4000-8000-000000000021','ad000000-0000-4000-8000-000000000011','test','tvprogram02','Two','Test',60,0,40,2),
 ('ad000000-0000-4000-8000-000000000022','ad000000-0000-4000-8000-000000000012','test','tvprogram03','Elsewhere','Test',60,0,40,3);
insert into agape.channels(channel_id,user_id,title) values('tv-programs-test','ad000000-0000-4000-8000-000000000001','Creator');
insert into agape.videos(video_id,channel_id,title,youtube_category_id,duration_seconds) values('tvprogvid01','tv-programs-test','Creator video','10',90);
insert into agape.video_topics(video_id,node_id,status) values('tvprogvid01','ad000000-0000-4000-8000-000000000011','approved');

set local role anon;
do $$ begin
 begin
  perform agape.create_tv_program('ad000000-0000-4000-8000-000000000011','Anonymous');
  raise exception 'Anonymous TV creation allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Creating requires administration or a verified video approved in the topic subtree.
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 if agape.can_create_tv('ad000000-0000-4000-8000-000000000011') then raise exception 'Creator without an approved video may create a TV'; end if;
 begin
  perform agape.create_tv_program('ad000000-0000-4000-8000-000000000011','Not mine');
  raise exception 'Ineligible TV creation accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000001',true);
do $$ begin
 if agape.can_create_tv(null) then raise exception 'Non-admin may create a root TV'; end if;
 begin
  perform agape.create_tv_program(null,'Root');
  raise exception 'Non-admin root TV accepted';
 exception when insufficient_privilege then null; end;
 if not agape.can_create_tv('ad000000-0000-4000-8000-000000000010') then raise exception 'Subtree creator cannot create a TV at the ancestor'; end if;
end $$;
select set_config('tv.a',agape.create_tv_program('ad000000-0000-4000-8000-000000000011','First')::text,true);
select set_config('tv.b',agape.create_tv_program('ad000000-0000-4000-8000-000000000011','Second')::text,true);

do $$ declare a uuid:=current_setting('tv.a')::uuid; b uuid:=current_setting('tv.b')::uuid;
 original jsonb; trimmed jsonb; denied boolean; eid uuid; fingerprint text; begin
 if jsonb_array_length(agape.tv_programs('ad000000-0000-4000-8000-000000000011'))<>2 then raise exception 'Topic does not list both TVs'; end if;
 original:=agape.tv_program_view(a,'en')->'fragments';
 if jsonb_array_length(original)<>2 or original->0->>'id'<>'ad000000-0000-4000-8000-000000000020' or agape.tv_program_view(b,'en')->'fragments'<>original then
  raise exception 'New TVs not seeded from the topic loop'; end if;
 -- Remove and trim in one save; the other TV, the topic loop, and the source excerpt are untouched.
 trimmed:=jsonb_build_array(jsonb_set(jsonb_set(original->0,'{start_seconds}','32'),'{end_seconds}','60'));
 perform agape.save_tv_layout(a,original,trimmed,'First TV');
 if jsonb_array_length(agape.tv_program_view(a,'en')->'fragments')<>1 or (agape.tv_program_view(a,'en')->'fragments'->0->>'start_seconds')::numeric<>32 then raise exception 'Remove and trim not applied'; end if;
 if agape.tv_program_view(b,'en')->'fragments'<>original then raise exception 'Editing one TV changed another'; end if;
 if jsonb_array_length(agape.tv_browse('ad000000-0000-4000-8000-000000000011','en')->'fragments')<>2
  or not exists(select 1 from agape.curated_tv_fragment where id='ad000000-0000-4000-8000-000000000020' and start_seconds=30 and end_seconds=75) then
  raise exception 'TV edit changed the topic loop or source excerpt'; end if;
 begin
  perform agape.save_tv_layout(a,original,trimmed,'Stale');
  raise exception 'Stale layout accepted';
 exception when serialization_failure then null; end;
 denied:=false;
 begin
  perform agape.save_tv_layout(a,trimmed,trimmed||jsonb_build_array(jsonb_build_object('id','ad000000-0000-4000-8000-000000000022','start_seconds',0,'end_seconds',40)),'Outside');
 exception when others then denied:=true; end;
 if not denied then raise exception 'Excerpt outside the home topic accepted'; end if;
 denied:=false;
 begin
  perform agape.save_tv_layout(a,trimmed,jsonb_build_array(jsonb_set(trimmed->0,'{end_seconds}','121')),'Too long');
 exception when others then denied:=true; end;
 if not denied or agape.tv_program_view(a,'en')->'fragments'->0->>'end_seconds'<>'60' then raise exception 'Out-of-video trim accepted'; end if;

 -- Subtitles belong to one TV and are checked against its own sections.
 perform agape.save_tv_track(a,'version1','en',0,'[{"id":"ad000000-0000-4000-8000-000000000030","section_id":"ad000000-0000-4000-8000-000000000020","start_seconds":33,"end_seconds":36,"markdown":"First TV"}]');
 if exists(select 1 from agape.tv_program_track where program_id=b) then raise exception 'Subtitles leaked into another TV'; end if;
 perform agape.save_tv_track(b,'version1','en',0,'[]');
 begin
  perform agape.save_tv_track(a,'version1','en',0,'[]');
  raise exception 'Stale TV subtitles accepted';
 exception when serialization_failure then null; end;
 denied:=false;
 begin
  perform agape.save_tv_track(a,'version1','en',1,'[{"id":"ad000000-0000-4000-8000-000000000031","section_id":"ad000000-0000-4000-8000-000000000021","start_seconds":1,"end_seconds":2,"markdown":"Removed"}]');
 exception when others then denied:=true; end;
 if not denied then raise exception 'Subtitle on a section outside this TV accepted'; end if;
 if (select count(*) from agape.tv_program_history where program_id=a)<>1 then raise exception 'TV subtitle history missing'; end if;

 -- Editions freeze only the reviewed state of their own TV.
 fingerprint:=agape.tv_edition_preview(a)->>'fingerprint';
 eid:=agape.publish_tv_edition(a,fingerprint);
 if not exists(select 1 from agape.tv_edition where id=eid and program_id=a and title='First TV' and jsonb_array_length(fragments)=1 and tracks->0->'cues'->0->>'markdown'='First TV') then raise exception 'Edition content incorrect'; end if;
 perform agape.save_tv_track(a,'version2','en',0,'[]');
 begin
  perform agape.publish_tv_edition(a,fingerprint);
  raise exception 'Edition published from a stale review';
 exception when serialization_failure then null; end;
 if exists(select 1 from agape.tv_edition where program_id=b) or (select count(*) from agape.tv_edition where program_id=a)<>1 then raise exception 'Editions not isolated per TV'; end if;
 begin
  update agape.tv_edition set title='Tampered' where id=eid;
  raise exception 'Edition mutation allowed';
 exception when insufficient_privilege then null; end;

 -- New excerpts join only the TV they were added to, within its topic.
 perform agape.add_tv_section(a,'ad000000-0000-4000-8000-000000000011','bbbbbbbbbbb','Added','Channel',60,0,30);
 if jsonb_array_length(agape.tv_program_view(a,'en')->'fragments')<>2
  or exists(select 1 from jsonb_array_elements(agape.tv_program_view(b,'en')->'fragments') f where f->>'title'='Added') then raise exception 'Added section not limited to its TV'; end if;
 denied:=false;
 begin
  perform agape.add_tv_section(a,'ad000000-0000-4000-8000-000000000012','ccccccccccc','Elsewhere','Channel',60,0,30);
 exception when others then denied:=true; end;
 if not denied then raise exception 'Section added outside the home topic'; end if;
end $$;

select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000002',true);
do $$ declare a uuid:=current_setting('tv.a')::uuid; begin
 if agape.can_edit_tv(a) then raise exception 'Non-owner can edit a TV'; end if;
 begin
  perform agape.save_tv_layout(a,'[]','[]','Other');
  raise exception 'Non-owner layout save allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.add_tv_section(a,'ad000000-0000-4000-8000-000000000011','ddddddddddd','Other','Channel',60,0,30);
  raise exception 'Non-owner section insertion allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.tv_edition_preview(a);
  raise exception 'Non-owner edition preview allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform agape.publish_tv_edition(a,'x');
  raise exception 'Non-owner publish allowed';
 exception when insufficient_privilege then null; end;
end $$;

-- Site administrators can moderate any TV and create the root TV.
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000003',true);
do $$ declare a uuid:=current_setting('tv.a')::uuid; root uuid; current_sections jsonb; begin
 current_sections:=agape.tv_program_view(a,'en')->'fragments';
 perform agape.save_tv_layout(a,current_sections,current_sections,'Moderated');
 root:=agape.create_tv_program(null,'Root TV');
 if jsonb_array_length(agape.tv_program_view(root,'en')->'fragments')<3 then raise exception 'Root TV not seeded from every topic'; end if;
end $$;
reset role;

set local role anon;
do $$ declare a uuid:=current_setting('tv.a')::uuid; begin
 if agape.tv_program_view(a,'en')->'program'->>'title'<>'Moderated' then raise exception 'Named TV not publicly viewable'; end if;
 if not exists(select 1 from agape.tv_program_track where program_id=a) then raise exception 'TV subtitles not publicly readable'; end if;
 begin
  perform agape.save_tv_track(a,'version3','en',0,'[]');
  raise exception 'Anonymous TV subtitles allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from agape.tv_program_history limit 1;
  raise exception 'Anonymous history access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
