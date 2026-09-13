-- Creating a TV program, and freezing only the snapshot its owner reviewed.
create function agape.can_claim_tv(p_node uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
  and not exists(select 1 from agape.tv_program where selection_key=coalesce(p_node::text,'root'))
  and (agape.is_admin() or (p_node is not null and exists(
   select 1 from agape.videos v join agape.channels c using(channel_id)
   join agape.video_topics vt using(video_id) join agape.descendants(p_node) d using(node_id)
   where c.user_id=auth.uid() and vt.status='approved'
    and v.verified_at>now()-interval '30 days' and c.verified_at>now()-interval '30 days')));
$$;
create function agape.claim_tv_program(p_node uuid,p_title text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if exists(select 1 from agape.tv_program where selection_key=coalesce(p_node::text,'root')) then raise exception 'This TV already has an owner.' using errcode='23505'; end if;
 if not agape.can_claim_tv(p_node) then raise exception 'Only a site administrator, or a creator with a verified video approved in this topic, can create this TV.' using errcode='42501'; end if;
 insert into agape.tv_program(selection_key,owner_id,title) values(coalesce(p_node::text,'root'),auth.uid(),trim(p_title));
end $$;
-- Saving requires the program row; previously the final update matched nothing and returned null.
create or replace function agape.save_tv_layout(p_node uuid,p_expected jsonb,p_sections jsonb,p_title text) returns integer
language plpgsql security definer set search_path='' as $$
declare current_sections jsonb; f jsonb; old jsonb; ids uuid[]; rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 if not exists(select 1 from agape.tv_program where selection_key=coalesce(p_node::text,'root')) then raise exception 'Create this TV before saving it.' using errcode='P0002'; end if;
 current_sections:=agape.tv_browse(p_node,'en')->'fragments';
 if (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(current_sections) v) is distinct from
 (select jsonb_agg(jsonb_build_array(v->>'id',v->'start_seconds',v->'end_seconds')) from jsonb_array_elements(p_expected) v) then
 raise exception 'This TV changed elsewhere. Your draft is safe on this device; reload before retrying.' using errcode='40001'; end if;
 select array_agg((v->>'id')::uuid) into ids from jsonb_array_elements(p_sections) v;
 select coalesce(revision,0) into rev from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root');
 perform agape.save_tv_order(p_node,coalesce(rev,0),ids);
 for f in select value from jsonb_array_elements(p_sections) loop
 select value into old from jsonb_array_elements(current_sections) where value->>'id'=f->>'id';
 perform agape.trim_tv_section(p_node,(f->>'id')::uuid,(old->>'start_seconds')::integer,(old->>'end_seconds')::integer,(f->>'start_seconds')::integer,(f->>'end_seconds')::integer);
 end loop;
 update agape.tv_program set title=p_title,revision=revision+1 where selection_key=coalesce(p_node::text,'root') returning revision into rev;
 return rev;
end $$;
-- Deterministic edition content: every alternative and language, including source fallback captions.
create function agape.tv_edition_snapshot(p_node uuid) returns jsonb language sql stable set search_path='' as $$
 with program as (select * from agape.tv_program where selection_key=coalesce(p_node::text,'root')),
 sections as (select coalesce(agape.tv_browse(p_node,'en')->'fragments','[]'::jsonb) v),
 source as (
  select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id') cue
  from sections cross join lateral jsonb_array_elements(sections.v) f join agape.tv_subtitle_cue s on s.fragment_id::text=f->>'id'
  union all
  select s.track,s.locale,to_jsonb(s)||jsonb_build_object('section_id',f->>'id')
  from sections cross join lateral jsonb_array_elements(sections.v) f join agape.subtitle_cues s on s.video_id=f->>'video_id'
  where not coalesce((f->>'curated')::boolean,false)
 ),
 tracks as (
  select t.track,t.locale,t.cues from agape.tv_selection_track t join program using(selection_key)
  union all
  select c.track,c.locale,jsonb_agg(c.cue order by (c.cue->>'start_seconds')::numeric,c.cue->>'id') from source c
  where not exists(select 1 from agape.tv_selection_track t where t.selection_key=coalesce(p_node::text,'root') and t.track=c.track and t.locale=c.locale)
  group by c.track,c.locale
 )
 select jsonb_build_object('title',program.title,'revision',program.revision,'fragments',sections.v,
  'tracks',(select coalesce(jsonb_agg(jsonb_build_object('track',track,'locale',locale,'cues',cues) order by track,locale),'[]') from tracks))
 from program cross join sections;
$$;
create function agape.tv_edition_preview(p_node uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snap jsonb;
begin
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 snap:=agape.tv_edition_snapshot(p_node);
 if snap is null then raise exception 'Create this TV before publishing an edition.' using errcode='P0002'; end if;
 return jsonb_build_object('title',snap->'title','revision',snap->'revision',
  'sections',(select coalesce(jsonb_agg(jsonb_build_object('id',f->'id','title',f->'title','start_seconds',f->'start_seconds','end_seconds',f->'end_seconds') order by n),'[]') from jsonb_array_elements(snap->'fragments') with ordinality e(f,n)),
  'tracks',(select coalesce(jsonb_agg(jsonb_build_object('track',t->'track','locale',t->'locale','cues',jsonb_array_length(t->'cues')) order by n),'[]') from jsonb_array_elements(snap->'tracks') with ordinality e(t,n)),
  'fingerprint',md5(snap::text));
end $$;
drop function agape.publish_tv_edition(uuid);
create function agape.publish_tv_edition(p_node uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare snap jsonb; edition_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('tv-layout:'||coalesce(p_node::text,'root'),0));
 if not agape.can_edit_tv(p_node) then raise exception 'TV owner access required' using errcode='42501'; end if;
 snap:=agape.tv_edition_snapshot(p_node);
 if snap is null then raise exception 'Create this TV before publishing an edition.' using errcode='P0002'; end if;
 if md5(snap::text) is distinct from p_fingerprint then raise exception 'This TV changed after you reviewed it. Review the edition again before publishing.' using errcode='40001'; end if;
 insert into agape.tv_edition(selection_key,title,revision,fragments,tracks,published_by)
 values(coalesce(p_node::text,'root'),snap->>'title',(snap->>'revision')::integer,snap->'fragments',snap->'tracks',auth.uid()) returning id into edition_id;
 return edition_id;
end $$;
revoke all on function agape.tv_edition_snapshot(uuid) from public,anon,authenticated;
revoke all on function agape.can_claim_tv(uuid),agape.claim_tv_program(uuid,text),agape.tv_edition_preview(uuid),agape.publish_tv_edition(uuid,text) from public;
grant execute on function agape.can_claim_tv(uuid) to anon,authenticated;
grant execute on function agape.claim_tv_program(uuid,text),agape.tv_edition_preview(uuid),agape.publish_tv_edition(uuid,text) to authenticated;
notify pgrst,'reload schema';
