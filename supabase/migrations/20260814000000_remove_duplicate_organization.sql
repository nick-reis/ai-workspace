begin;

create or replace function public.create_ai_entity_resolving_identity(
  p_type text,
  p_title text,
  p_summary text default null,
  p_markdown text default null,
  p_ai_run_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_normalized_title text := public.normalize_graph_label(p_title);
  v_candidates jsonb;
  v_candidate_count integer;
  v_created jsonb;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_type not in ('note', 'project', 'topic', 'person') then
    raise exception 'invalid_ai_entity_type' using errcode = '23514';
  end if;

  if v_normalized_title = '' then
    raise exception 'empty_title' using errcode = '23514';
  end if;

  if p_ai_run_id is null or not exists (
    select 1 from public.ai_runs
    where id = p_ai_run_id and owner_id = v_owner
  ) then
    raise exception 'ai_run_not_found' using errcode = '42501';
  end if;

  -- Serialize exact same-type identity creation across conversations and clients.
  perform pg_advisory_xact_lock(hashtextextended(
    v_owner::text || ':' || p_type || ':' || v_normalized_title,
    0
  ));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'title', n.title,
    'summary', n.summary,
    'version', n.version,
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'match_kind', case
      when public.normalize_graph_label(n.title) = v_normalized_title then 'title'
      else 'alias'
    end
  ) order by n.updated_at desc, n.id), '[]'::jsonb)
  into v_candidates
  from public.nodes n
  where n.owner_id = v_owner
    and n.type = p_type
    and n.archived_at is null
    and (
      public.normalize_graph_label(n.title) = v_normalized_title
      or exists (
        select 1 from public.node_aliases a
        where a.owner_id = v_owner
          and a.node_id = n.id
          and a.normalized_alias = v_normalized_title
      )
    );

  v_candidate_count := jsonb_array_length(v_candidates);

  if v_candidate_count = 1 then
    return jsonb_build_object(
      'status', 'existing',
      'reused', true,
      'id', v_candidates->0->>'id',
      'node', v_candidates->0,
      'candidates', v_candidates
    );
  elsif v_candidate_count > 1 then
    return jsonb_build_object(
      'status', 'ambiguous',
      'reused', false,
      'candidates', v_candidates
    );
  end if;

  v_created := public.create_entity(
    p_type,
    p_title,
    p_summary,
    p_markdown,
    'ai',
    p_ai_run_id,
    p_idempotency_key
  );

  return jsonb_build_object(
    'status', 'created',
    'reused', false,
    'id', v_created->>'id',
    'node', v_created,
    'candidates', '[]'::jsonb
  );
end;
$$;

revoke all on function public.create_ai_entity_resolving_identity(text, text, text, text, uuid, text)
  from public, anon;
grant execute on function public.create_ai_entity_resolving_identity(text, text, text, text, uuid, text)
  to authenticated;

create or replace function public.bound_conversation_node_summary_projection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type = 'conversation' and new.summary is not null then
    new.summary := left(new.summary, 2000);
  end if;
  return new;
end;
$$;

drop trigger if exists nodes_bound_conversation_summary_projection on public.nodes;
create trigger nodes_bound_conversation_summary_projection
before insert or update of summary on public.nodes
for each row execute function public.bound_conversation_node_summary_projection();

create or replace function public.subsume_automated_related_to()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_specific_edge public.edges%rowtype;
begin
  if new.status <> 'active' or new.retracted_at is not null then
    return new;
  end if;

  select * into v_specific_edge
  from public.edges
  where id = new.edge_id and owner_id = new.owner_id;

  if not found or v_specific_edge.relationship_type = 'related_to' then
    return new;
  end if;

  update public.edge_assertions broad_assertion
  set status = 'retracted',
      retracted_at = now(),
      reason = coalesce(broad_assertion.reason, '') ||
        case when broad_assertion.reason is null or broad_assertion.reason = '' then '' else ' ' end ||
        'Superseded by the more precise ' || v_specific_edge.relationship_type || ' relationship.'
  from public.edges broad_edge
  where broad_assertion.edge_id = broad_edge.id
    and broad_assertion.owner_id = new.owner_id
    and broad_edge.owner_id = new.owner_id
    and broad_edge.relationship_type = 'related_to'
    and broad_edge.archived_at is null
    and broad_assertion.provenance in ('ai', 'system')
    and broad_assertion.status = 'active'
    and broad_assertion.retracted_at is null
    and (
      (broad_edge.source_node_id = v_specific_edge.source_node_id
        and broad_edge.target_node_id = v_specific_edge.target_node_id)
      or
      (broad_edge.source_node_id = v_specific_edge.target_node_id
        and broad_edge.target_node_id = v_specific_edge.source_node_id)
    );

  return new;
end;
$$;

drop trigger if exists edge_assertions_subsume_automated_related_to on public.edge_assertions;
create trigger edge_assertions_subsume_automated_related_to
after insert or update of status, retracted_at on public.edge_assertions
for each row execute function public.subsume_automated_related_to();

revoke all on function public.bound_conversation_node_summary_projection() from public, anon, authenticated;
revoke all on function public.subsume_automated_related_to() from public, anon, authenticated;

-- Apply the same narrow rule to already-existing automated broad relationships.
update public.edge_assertions broad_assertion
set status = 'retracted',
    retracted_at = now(),
    reason = coalesce(broad_assertion.reason, '') ||
      case when broad_assertion.reason is null or broad_assertion.reason = '' then '' else ' ' end ||
      'Superseded by an existing more precise relationship.'
from public.edges broad_edge
where broad_assertion.edge_id = broad_edge.id
  and broad_edge.relationship_type = 'related_to'
  and broad_edge.archived_at is null
  and broad_assertion.provenance in ('ai', 'system')
  and broad_assertion.status = 'active'
  and broad_assertion.retracted_at is null
  and exists (
    select 1
    from public.edges specific_edge
    join public.edge_assertions specific_assertion
      on specific_assertion.edge_id = specific_edge.id
    where specific_edge.owner_id = broad_edge.owner_id
      and specific_edge.relationship_type <> 'related_to'
      and specific_edge.archived_at is null
      and specific_assertion.status = 'active'
      and specific_assertion.retracted_at is null
      and (
        (specific_edge.source_node_id = broad_edge.source_node_id
          and specific_edge.target_node_id = broad_edge.target_node_id)
        or
        (specific_edge.source_node_id = broad_edge.target_node_id
          and specific_edge.target_node_id = broad_edge.source_node_id)
      )
  );

comment on column public.conversation_summaries.topics is
  'Private AI retrieval keywords. They are not user tags, canonical topic nodes, or permanent graph organization.';
comment on column public.nodes.summary is
  'Compact retrieval text. For conversations this is a bounded search projection of the canonical conversation_summaries record.';
comment on function public.create_ai_entity_resolving_identity(text, text, text, text, uuid, text) is
  'Atomically reuses one exact same-type title/alias match, returns ambiguity for multiple matches, or creates a new AI entity.';
comment on function public.subsume_automated_related_to() is
  'Retracts only automated related_to support when a more precise active relationship is added; user assertions are preserved.';

commit;
