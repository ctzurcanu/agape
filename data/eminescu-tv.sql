-- Source: https://www.youtube.com/playlist?list=PLrZFPVQM38MfjRjEyCgSk5T8SZ-nwzJ0U
-- Playlist titles and durations observed 2026-09-12. Opening excerpts, not claimed highlights.
do $$
declare topic uuid; parent uuid;
begin
 select n.node_id into strict parent from agape.ontology_node n
 join agape.ontology_node a on a.node_id=n.parent_id
 where n.slug='poetry-and-literature' and a.slug='ai-music';
 insert into agape.ontology_node(parent_id,slug,position) values(parent,'mihai-eminescu',0)
 on conflict(parent_id,slug) do nothing;
 select node_id into strict topic from agape.ontology_node where parent_id=parent and slug='mihai-eminescu';
 insert into agape.node_name(node_id,locale,name,description)
 values(topic,'en','Mihai Eminescu','AI musical interpretations of Mihai Eminescu’s poetry, with a TV loop from Christian Tzurcanu’s playlist.') on conflict do nothing;
 insert into agape.curated_tv_fragment(node_id,playlist_id,video_id,title,channel_title,duration_seconds,start_seconds,end_seconds,position)
 select topic,'PLrZFPVQM38MfjRjEyCgSk5T8SZ-nwzJ0U',v.id,v.title,'Christian Tzurcanu',v.duration,30,75,v.position
 from (values
 ('7o8iZjM5qzA','Ode (in ancient meter) - Odă (în metru antic)',343,1),
 ('xxktydeHNv4','La steaua - To the star',204,2),
 ('tjg26PdW3eA','Ode (in ancient meter) - Odă (în metru antic) v2',230,3),
 ('bAfvrJVQCFo','Dintre sute de catarge - Among hundreds of masts',241,4),
 ('6BR5rqC03Og','Pe lângă plopii fără soț - Where the lonely poplars grow',239,5),
 ('5eVJvUVz90w','Why do you wail, o forest trees? - Ce te legeni, codrule?',241,6),
 ('5Eyu6Vq6-ng','Of all the ships - Dintre sute de catarge ( Mihai Eminescu )',241,7)
 ) as v(id,title,duration,position) on conflict do nothing;
end $$;
