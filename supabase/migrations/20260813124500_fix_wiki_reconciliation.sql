create or replace function public.reconcile_note_links(
  p_note_id uuid,
  p_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  note_version bigint;
  link_record record;
  candidates uuid[];
  target_id uuid;
  semantic_edge public.edges%rowtype;
  keep_keys text[] := array[]::text[];
  origin text;
  resolved_count integer := 0;
  unresolved_count integer := 0;
begin
  select content_version into note_version from public.notes where node_id = p_note_id and owner_id = owner;
  if note_version is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.unresolved_links where owner_id = owner and source_note_id = p_note_id;
  for link_record in
    select public.normalize_graph_label(value->>'label') normalized_label,
      min(value->>'label') label,
      jsonb_agg(value order by (value->>'start')::integer) locations
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) value
    where nullif(btrim(value->>'label'), '') is not null
    group by public.normalize_graph_label(value->>'label')
  loop
    select array_agg(id order by id) into candidates from (
      select n.id from public.nodes n
      where n.owner_id = owner and n.archived_at is null
        and (
          public.normalize_graph_label(n.title) = link_record.normalized_label
          or exists (
            select 1 from public.node_aliases a
            where a.node_id = n.id and a.owner_id = owner and a.normalized_alias = link_record.normalized_label
          )
        )
    ) matches;
    if coalesce(array_length(candidates, 1), 0) = 1 then
      target_id := candidates[1];
      if target_id <> p_note_id then
        semantic_edge := public.ensure_semantic_edge(owner, p_note_id, target_id, 'references');
        origin := 'wiki:' || p_note_id::text || ':' || target_id::text;
        keep_keys := array_append(keep_keys, origin);
        insert into public.edge_assertions(
          owner_id, edge_id, provenance, actor_id, source_node_id, origin_key, reason, source_locator
        ) values(
          owner, semantic_edge.id, 'markdown', owner, p_note_id, origin,
          'Wiki-link in ' || link_record.label,
          jsonb_build_object('note_id', p_note_id, 'content_version', note_version, 'mentions', link_record.locations)
        )
        on conflict (owner_id, edge_id, provenance, origin_key) where retracted_at is null and origin_key is not null
        do update set source_locator = excluded.source_locator, reason = excluded.reason,
          status = 'active', retracted_at = null, updated_at = now();
        resolved_count := resolved_count + 1;
      end if;
    else
      insert into public.unresolved_links(
        owner_id, source_note_id, target_label, normalized_label, source_locations,
        candidate_node_ids, content_version, status
      ) values(
        owner, p_note_id, link_record.label, link_record.normalized_label, link_record.locations,
        coalesce(candidates, array[]::uuid[]), note_version,
        case when coalesce(array_length(candidates, 1), 0) = 0 then 'unresolved' else 'ambiguous' end
      );
      unresolved_count := unresolved_count + 1;
    end if;
  end loop;
  update public.edge_assertions
  set status = 'retracted', retracted_at = now()
  where owner_id = owner and provenance = 'markdown' and source_node_id = p_note_id
    and retracted_at is null and not (origin_key = any(keep_keys));
  update public.notes set parsed_at = now() where node_id = p_note_id;
  return jsonb_build_object('resolved', resolved_count, 'unresolved', unresolved_count);
end;
$$;
