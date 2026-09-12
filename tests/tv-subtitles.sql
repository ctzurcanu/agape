-- Run only inside a transaction that is always rolled back.
insert into auth.users(id) values('ab000000-0000-4000-8000-000000000001'),('ab000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into agape.tv_subtitle_cue(id,fragment_id,locale,start_seconds,end_seconds,markdown)
select 'ab000000-0000-4000-8000-000000000003',id,'en',30,35,'**Bold** *italic* [source](https://example.org)' from agape.curated_tv_fragment order by position limit 1;
do $$ begin
 begin
  insert into agape.tv_subtitle_cue(fragment_id,locale,start_seconds,end_seconds,markdown)
  select id,'en',0,100,'Outside excerpt' from agape.curated_tv_fragment limit 1;
  raise exception 'Out-of-bounds subtitle accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into agape.tv_subtitle_cue(fragment_id,user_id,locale,start_seconds,end_seconds,markdown)
  select id,'ab000000-0000-4000-8000-000000000002','en',30,35,'Impersonation' from agape.curated_tv_fragment limit 1;
  raise exception 'Impersonation accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
update agape.tv_subtitle_cue set markdown='**Edited** [link](https://example.org)',user_id=auth.uid() where id='ab000000-0000-4000-8000-000000000003';
insert into agape.tv_subtitle_cue(fragment_id,locale,track,start_seconds,end_seconds,markdown)
select fragment_id,'en','version2',30,35,'Independent version' from agape.tv_subtitle_cue where id='ab000000-0000-4000-8000-000000000003';
do $$ begin
 if not exists(select 1 from agape.tv_subtitle_cue where id='ab000000-0000-4000-8000-000000000003' and markdown='**Edited** [link](https://example.org)' and track='version1') then raise exception 'Track edit failed'; end if;
 if not exists(select 1 from agape.tv_subtitle_cue where track='version2' and markdown='Independent version') then raise exception 'Alternative track failed'; end if;
 begin
  update agape.tv_subtitle_cue set end_seconds=1000,user_id=auth.uid() where id='ab000000-0000-4000-8000-000000000003';
  raise exception 'Out-of-bounds edit accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000001',true);
delete from agape.tv_subtitle_cue where id='ab000000-0000-4000-8000-000000000003';
do $$ begin
 if exists(select 1 from agape.tv_subtitle_cue where id='ab000000-0000-4000-8000-000000000003') then raise exception 'Author could not delete the subtitle'; end if;
end $$;
reset role;
