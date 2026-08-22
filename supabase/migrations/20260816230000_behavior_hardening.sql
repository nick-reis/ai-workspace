begin;

-- A named/selected entity is explicit conversational context. Record it once
-- per conversation/entity pair without turning arbitrary retrieval results
-- into durable graph claims.
create or replace function public.record_conversation_context(
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_text text,
  p_selected_node_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_item jsonb;
  v_target_id uuid;
  v_match_reason text;
  v_linked jsonb := '[]'::jsonb;
begin
  if v_owner_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversations
    where node_id = p_conversation_id and owner_id = v_owner_id
  ) then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.messages
    where id = p_source_message_id and conversation_id = p_conversation_id
      and owner_id = v_owner_id and role = 'user'
  ) then
    raise exception 'source_message_not_found' using errcode = 'P0002';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(public.resolve_explicit_node_mentions(p_text, 8))
    union all
    select jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'match_reason', 'selected_context'
    )
    from public.nodes n
    where p_selected_node_id is not null
      and n.id = p_selected_node_id
      and n.owner_id = v_owner_id
      and n.type in ('note', 'memory')
      and n.archived_at is null
  loop
    v_target_id := (v_item->>'id')::uuid;
    v_match_reason := coalesce(v_item->>'match_reason', 'explicit_mention');

    -- Production is the more precise relationship and must not be shadowed by
    -- a broad discussion edge.
    if exists (
      select 1
      from public.edges e
      join public.edge_assertions a on a.edge_id = e.id
      where e.owner_id = v_owner_id
        and e.source_node_id = p_conversation_id
        and e.target_node_id = v_target_id
        and e.relationship_type = 'produced'
        and e.archived_at is null
        and a.status = 'active'
        and a.retracted_at is null
    ) then
      continue;
    end if;

    perform public.ensure_conversation_context_edge(
      v_owner_id,
      p_conversation_id,
      v_target_id,
      'discusses',
      case when v_match_reason = 'selected_context'
        then 'Used as the selected context for this conversation.'
        else 'Explicitly mentioned by the user in this conversation.'
      end,
      null,
      p_source_message_id,
      jsonb_build_object(
        'conversation_id', p_conversation_id,
        'source_message_id', p_source_message_id,
        'match_reason', v_match_reason,
        'matched_label', v_item->>'matched_label'
      ),
      'conversation-discusses:' || p_conversation_id::text || ':' || v_target_id::text
    );

    if not v_linked @> jsonb_build_array(v_target_id::text) then
      v_linked := v_linked || jsonb_build_array(v_target_id::text);
    end if;
  end loop;

  return jsonb_build_object('conversation_id', p_conversation_id, 'linked_node_ids', v_linked);
end;
$$;

revoke all on function public.record_conversation_context(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.record_conversation_context(uuid, uuid, text, uuid) to authenticated;

-- Reconciliation reports what happened at the assertion boundary. This makes
-- it visible when a wiki assertion was removed but an independently approved
-- assertion correctly kept the canonical edge alive.
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
  retracted_count integer := 0;
  removed_edge_ids uuid[] := array[]::uuid[];
  preserved_edge_count integer := 0;
begin
  select content_version into note_version
  from public.notes where node_id = p_note_id and owner_id = owner;
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
            where a.node_id = n.id and a.owner_id = owner
              and a.normalized_alias = link_record.normalized_label
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
          owner_id, edge_id, provenance, actor_id, source_node_id,
          origin_key, reason, source_locator
        ) values(
          owner, semantic_edge.id, 'markdown', owner, p_note_id, origin,
          'Wiki-link in ' || link_record.label,
          jsonb_build_object(
            'note_id', p_note_id,
            'content_version', note_version,
            'mentions', link_record.locations
          )
        )
        on conflict (owner_id, edge_id, provenance, origin_key)
          where retracted_at is null and origin_key is not null
        do update set
          source_locator = excluded.source_locator,
          reason = excluded.reason,
          status = 'active',
          retracted_at = null,
          updated_at = now();
        resolved_count := resolved_count + 1;
      end if;
    else
      insert into public.unresolved_links(
        owner_id, source_note_id, target_label, normalized_label,
        source_locations, candidate_node_ids, content_version, status
      ) values(
        owner, p_note_id, link_record.label, link_record.normalized_label,
        link_record.locations, coalesce(candidates, array[]::uuid[]), note_version,
        case when coalesce(array_length(candidates, 1), 0) = 0
          then 'unresolved' else 'ambiguous' end
      );
      unresolved_count := unresolved_count + 1;
    end if;
  end loop;

  with retracted as (
    update public.edge_assertions
    set status = 'retracted', retracted_at = now()
    where owner_id = owner
      and provenance = 'markdown'
      and source_node_id = p_note_id
      and retracted_at is null
      and not coalesce(origin_key = any(keep_keys), false)
    returning edge_id
  )
  select count(*)::integer, coalesce(array_agg(distinct edge_id), array[]::uuid[])
  into retracted_count, removed_edge_ids
  from retracted;

  select count(*)::integer into preserved_edge_count
  from public.edges e
  where e.id = any(removed_edge_ids)
    and e.owner_id = owner
    and e.archived_at is null
    and exists (
      select 1 from public.edge_assertions a
      where a.edge_id = e.id and a.owner_id = owner
        and a.status = 'active' and a.retracted_at is null
    );

  update public.notes set parsed_at = now() where node_id = p_note_id;
  return jsonb_build_object(
    'resolved', resolved_count,
    'unresolved', unresolved_count,
    'retracted_markdown_assertions', retracted_count,
    'preserved_edges_with_other_support', preserved_edge_count
  );
end;
$$;

create or replace function public.resolve_graph_change(
  p_change_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  change_row public.graph_changes%rowtype;
  before_note public.notes%rowtype;
  after_note public.notes%rowtype;
  before_assertion public.edge_assertions%rowtype;
  after_assertion public.edge_assertions%rowtype;
  expected_version bigint;
  reconciliation jsonb;
begin
  select * into change_row from public.graph_changes
  where id = p_change_id and owner_id = owner and approval_state = 'proposed';
  if change_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  if not p_approve then
    update public.graph_changes set approval_state = 'rejected' where id = p_change_id;
    return jsonb_build_object('change_id', p_change_id, 'status', 'rejected');
  end if;

  if change_row.operation = 'update_note' then
    select * into before_note from public.notes
    where node_id = change_row.node_id and owner_id = owner;
    expected_version := (change_row.after_snapshot->>'expected_content_version')::bigint;
    if before_note.node_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    if before_note.content_version <> expected_version then
      raise exception 'version_conflict' using errcode = '40001';
    end if;
    update public.notes set
      markdown = change_row.after_snapshot->>'markdown',
      content_version = content_version + 1,
      parsed_at = null
    where node_id = change_row.node_id returning * into after_note;
    reconciliation := public.reconcile_note_links(
      change_row.node_id,
      coalesce(change_row.after_snapshot->'links', '[]'::jsonb)
    );
    update public.graph_changes set
      approval_state = 'applied',
      before_snapshot = to_jsonb(before_note),
      after_snapshot = to_jsonb(after_note) ||
        jsonb_build_object('link_reconciliation', reconciliation)
    where id = p_change_id;
  elsif change_row.operation = 'retract_assertion' then
    select * into before_assertion from public.edge_assertions
    where id = change_row.assertion_id and owner_id = owner and retracted_at is null;
    if before_assertion.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.edge_assertions
    set status = 'retracted', retracted_at = now(),
        reason = coalesce(change_row.reason, reason)
    where id = before_assertion.id returning * into after_assertion;
    update public.graph_changes set
      approval_state = 'applied',
      before_snapshot = to_jsonb(before_assertion),
      after_snapshot = to_jsonb(after_assertion)
    where id = p_change_id;
  else
    raise exception 'unsupported_proposal' using errcode = '0A000';
  end if;

  return jsonb_build_object(
    'change_id', p_change_id,
    'status', 'applied',
    'link_reconciliation', reconciliation
  );
end;
$$;

-- Conversation summaries are first-class retrieval text. Previously only a
-- whole-string ILIKE could match them, which favored the wrong similarly named
-- conversation for natural-language queries.
create or replace function public.search_graph(
  p_query text default '',
  p_types text[] default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with query_parts as (
    select trim(coalesce(p_query, '')) as query_text,
           case when trim(coalesce(p_query, '')) = '' then null
                else plainto_tsquery('simple', trim(p_query)) end as ts_query
  ), candidates as (
    select n.id, n.owner_id, n.type, n.title, n.summary, n.version,
           n.created_at, n.updated_at, n.archived_at,
           left(coalesce(no.markdown, ''), 700) as content_excerpt,
           greatest(
             case when lower(n.title) = lower(q.query_text) then 12.0 else 0.0 end,
             case when n.title ilike '%' || q.query_text || '%' then 8.0 else 0.0 end,
             case when exists (
               select 1 from public.node_aliases a
               where a.node_id = n.id and a.owner_id = auth.uid()
                 and a.alias ilike '%' || q.query_text || '%'
             ) then 7.0 else 0.0 end,
             case when n.summary ilike '%' || q.query_text || '%' then 5.0 else 0.0 end,
             case when q.ts_query is not null then
               ts_rank_cd(
                 setweight(to_tsvector('simple', coalesce(n.title, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(n.summary, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(no.markdown, '')), 'C'),
                 q.ts_query
               ) * 8.0
               else 0.0 end
           ) as rank,
           case
             when lower(n.title) = lower(q.query_text) then 'exact_title'
             when n.title ilike '%' || q.query_text || '%' then 'title'
             when exists (
               select 1 from public.node_aliases a
               where a.node_id = n.id and a.owner_id = auth.uid()
                 and a.alias ilike '%' || q.query_text || '%'
             ) then 'alias'
             when n.summary ilike '%' || q.query_text || '%' then 'summary'
             when q.ts_query is not null
               and to_tsvector('simple', coalesce(n.summary, '')) @@ q.ts_query
               then 'summary_terms'
             else 'note_content'
           end as match_reason
    from public.nodes n
    left join public.notes no on no.node_id = n.id
    cross join query_parts q
    where n.owner_id = auth.uid()
      and n.archived_at is null
      and (p_types is not null or n.type <> 'conversation')
      and (p_types is null or n.type = any(p_types))
      and (
        q.query_text = ''
        or n.title ilike '%' || q.query_text || '%'
        or coalesce(n.summary, '') ilike '%' || q.query_text || '%'
        or exists (
          select 1 from public.node_aliases a
          where a.node_id = n.id and a.owner_id = auth.uid()
            and a.alias ilike '%' || q.query_text || '%'
        )
        or (
          q.ts_query is not null
          and (
            to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.summary, '')) @@ q.ts_query
            or to_tsvector('simple', coalesce(no.markdown, '')) @@ q.ts_query
          )
        )
      )
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.rank desc, c.updated_at desc), '[]'::jsonb)
  from (
    select * from candidates
    order by rank desc, updated_at desc
    limit least(greatest(p_limit, 1), 50)
  ) c;
$$;

grant execute on function public.resolve_graph_change(uuid, boolean) to authenticated;

comment on function public.record_conversation_context(uuid, uuid, text, uuid) is
  'Creates idempotent discusses support only for explicit/typo-resolved mentions and selected context, never incidental retrieval results.';
comment on function public.reconcile_note_links(uuid, jsonb) is
  'Reconciles explicit wiki-link assertions and reports whether independently supported canonical edges were preserved.';

commit;
