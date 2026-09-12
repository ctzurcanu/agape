-- Original editorial notes, not transcribed lyrics or translations.
insert into agape.tv_subtitle_cue(fragment_id,user_id,locale,start_seconds,end_seconds,markdown,track)
select f.id,null,'en',f.start_seconds+v.offset_seconds,f.start_seconds+v.offset_seconds+15,
case v.offset_seconds
when 0 then '**Mihai Eminescu** · *' || replace(f.title,'*','') || '*'
when 15 then 'An AI music interpretation by [Christian Tzurcanu](https://www.youtube.com/@ChristianTzurcanu).'
else '[Explore the poetry playlist](https://www.youtube.com/playlist?list=PLrZFPVQM38MfjRjEyCgSk5T8SZ-nwzJ0U) · [Full video](https://www.youtube.com/watch?v=' || f.video_id || ')' end,
'version1'
from agape.curated_tv_fragment f cross join (values(0),(15),(30)) v(offset_seconds)
where f.playlist_id='PLrZFPVQM38MfjRjEyCgSk5T8SZ-nwzJ0U'
and not exists(select 1 from agape.tv_subtitle_cue c where c.fragment_id=f.id and c.track='version1' and c.locale='en');
