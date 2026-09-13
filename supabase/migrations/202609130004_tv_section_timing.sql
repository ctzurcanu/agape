create table agape.tv_selection_timing (
 selection_key text not null, section_id uuid not null, start_seconds integer not null,
 end_seconds integer not null, primary key(selection_key,section_id),
 check(start_seconds>=0 and end_seconds>start_seconds)
);
alter table agape.tv_selection_timing enable row level security;
grant select on agape.tv_selection_timing to anon,authenticated;
create policy selection_timing_read on agape.tv_selection_timing for select to anon,authenticated using(selection_key='root' or exists(select 1 from agape.ontology_node n where n.node_id::text=selection_key and n.status='published'));
create or replace function agape.tv_browse(p_node uuid default null,p_locale text default 'en') returns jsonb
language sql stable security invoker set search_path='' as $$
with base as (select agape.tv_browse_unordered(p_node,p_locale) data), layout as (
 select section_ids from agape.tv_selection_order where selection_key=coalesce(p_node::text,'root')
)
select jsonb_set(data,'{fragments}',coalesce((select jsonb_agg(
 f.value || case when t.section_id is null then '{}'::jsonb else jsonb_build_object('start_seconds',t.start_seconds,'end_seconds',t.end_seconds) end
 order by coalesce(array_position((select section_ids from layout),(f.value->>'id')::uuid),2147483647),f.ordinality)
 from jsonb_array_elements(data->'fragments') with ordinality f
 left join agape.tv_selection_timing t on t.selection_key=coalesce(p_node::text,'root') and t.section_id=(f.value->>'id')::uuid),'[]'::jsonb)) from base;
$$;
create function agape.trim_tv_section(p_node uuid,p_section uuid,p_expected_start integer,p_expected_end integer,p_start integer,p_end integer) returns void
language plpgsql security definer set search_path='' as $$
declare f jsonb; duration integer;
begin
 if not agape.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('tv-timing:'||coalesce(p_node::text,'root')||p_section::text,0));
 select value into f from jsonb_array_elements(agape.tv_browse(p_node,'en')->'fragments') where value->>'id'=p_section::text;
 if f is null then raise exception 'Section unavailable'; end if;
 if (f->>'start_seconds')::integer is distinct from p_expected_start or (f->>'end_seconds')::integer is distinct from p_expected_end then raise exception 'Section timing changed. Reopen the editor before trimming.' using errcode='40001'; end if;
 if coalesce((f->>'curated')::boolean,false) then select duration_seconds into duration from agape.curated_tv_fragment where id=p_section;
 else select v.duration_seconds into duration from agape.fragments s join agape.videos v using(video_id) where s.id=p_section; end if;
 if p_start is null or p_end is null or duration is null or p_start<0 or p_end<=p_start or p_end>duration then raise exception 'Start and end must be within the original video, with end after start'; end if;
 insert into agape.tv_selection_timing values(coalesce(p_node::text,'root'),p_section,p_start,p_end)
 on conflict(selection_key,section_id) do update set start_seconds=excluded.start_seconds,end_seconds=excluded.end_seconds;
end $$;
revoke all on function agape.trim_tv_section(uuid,uuid,integer,integer,integer,integer) from public;
grant execute on function agape.trim_tv_section(uuid,uuid,integer,integer,integer,integer) to authenticated;
