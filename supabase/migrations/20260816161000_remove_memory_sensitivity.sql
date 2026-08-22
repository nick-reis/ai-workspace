begin;

drop function if exists public.propose_memory(text, text, text, text, numeric, text, timestamptz, uuid, uuid[], jsonb);
drop function if exists public.update_memory_proposal(uuid, text, text, text, numeric, text, timestamptz, jsonb);
drop function if exists public.resolve_memory_proposal(uuid, boolean);
drop function if exists public.undo_memory_proposal(uuid);
drop function if exists public.search_memory_context(text, integer);

alter table public.memories drop column sensitivity;
alter table public.memory_revisions drop column sensitivity;
alter table public.memory_proposals drop column sensitivity;

create or replace function public.propose_memory(
  p_semantic_key text,
  p_title text,
  p_kind text,
  p_statement text,
  p_confidence numeric,
  p_expires_at timestamptz,
  p_ai_run_id uuid,
  p_source_message_ids uuid[],
  p_connections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_key text := public.normalize_memory_key(p_semantic_key);
  v_run public.ai_runs%rowtype;
  v_existing public.memories%rowtype;
  v_existing_node public.nodes%rowtype;
  v_proposal public.memory_proposals%rowtype;
  v_connection jsonb;
  v_source_count integer;
  v_status text := 'pending';
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if char_length(v_key) < 3 or char_length(v_key) > 120 then
    raise exception 'invalid_memory_key' using errcode = '23514';
  end if;
  if p_kind not in ('fact', 'preference', 'goal', 'constraint', 'skill')
     or p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid_memory_fields' using errcode = '23514';
  end if;
  if btrim(coalesce(p_title, '')) = '' or btrim(coalesce(p_statement, '')) = '' then
    raise exception 'empty_memory_content' using errcode = '23514';
  end if;

  select * into v_run from public.ai_runs
  where id = p_ai_run_id and owner_id = v_user;
  if not found or v_run.conversation_id is null then
    raise exception 'ai_run_not_found' using errcode = '42501';
  end if;

  select count(*)::integer into v_source_count
  from public.messages
  where id = any(coalesce(p_source_message_ids, '{}'::uuid[]))
    and owner_id = v_user
    and conversation_id = v_run.conversation_id
    and role = 'user';
  if v_source_count = 0
     or v_source_count <> cardinality(coalesce(p_source_message_ids, '{}'::uuid[])) then
    raise exception 'invalid_memory_sources' using errcode = '23514';
  end if;

  select * into v_existing
  from public.memories
  where owner_id = v_user and semantic_key = v_key
  limit 1;
  if v_existing.node_id is not null then
    select * into v_existing_node from public.nodes where id = v_existing.node_id;
  end if;

  if v_existing.node_id is not null
     and v_existing_node.archived_at is null
     and public.normalize_graph_label(v_existing.statement) = public.normalize_graph_label(p_statement)
     and v_existing.kind = p_kind
     and v_existing.expires_at is not distinct from p_expires_at then
    v_status := 'superseded';
  end if;

  insert into public.memory_proposals (
    owner_id, ai_run_id, conversation_id, semantic_key, action, status,
    title, kind, statement, confidence, expires_at,
    existing_memory_node_id, superseded_by_memory_id, before_snapshot, resolved_at
  ) values (
    v_user, p_ai_run_id, v_run.conversation_id, v_key,
    case when v_existing.node_id is null then 'create' else 'update' end,
    v_status, btrim(p_title), p_kind, btrim(p_statement), p_confidence,
    p_expires_at, v_existing.node_id,
    case when v_status = 'superseded' then v_existing.node_id else null end,
    case when v_existing.node_id is null then null else
      jsonb_build_object('node', to_jsonb(v_existing_node), 'memory', to_jsonb(v_existing)) end,
    case when v_status = 'superseded' then now() else null end
  )
  on conflict (ai_run_id, semantic_key) do update set
    title = excluded.title,
    kind = excluded.kind,
    statement = excluded.statement,
    confidence = excluded.confidence,
    expires_at = excluded.expires_at
  returning * into v_proposal;

  insert into public.memory_proposal_sources (
    owner_id, proposal_id, source_message_id, conversation_id
  )
  select v_user, v_proposal.id, m.id, v_run.conversation_id
  from public.messages m
  where m.id = any(p_source_message_ids)
  on conflict (proposal_id, source_message_id) do nothing;

  if v_proposal.status = 'pending' then
    for v_connection in select value from jsonb_array_elements(coalesce(p_connections, '[]'::jsonb))
    loop
      perform public.validate_memory_connection(
        v_user,
        (v_connection->>'existing_node_id')::uuid,
        v_connection->>'relationship_type'
      );
      insert into public.memory_proposal_connections (
        owner_id, proposal_id, existing_node_id, direction,
        relationship_type, reason, confidence, selected
      ) values (
        v_user, v_proposal.id, (v_connection->>'existing_node_id')::uuid,
        v_connection->>'direction', v_connection->>'relationship_type',
        btrim(v_connection->>'reason'), (v_connection->>'confidence')::numeric,
        coalesce((v_connection->>'selected')::boolean, true)
      )
      on conflict (proposal_id, existing_node_id, direction, relationship_type)
      do update set reason = excluded.reason, confidence = excluded.confidence,
                    selected = excluded.selected;
    end loop;
  end if;

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'status', case when v_status = 'superseded' then 'already_current' else 'pending' end
  );
end;
$$;

create or replace function public.update_memory_proposal(
  p_proposal_id uuid,
  p_title text,
  p_kind text,
  p_statement text,
  p_confidence numeric,
  p_expires_at timestamptz,
  p_connections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_proposal public.memory_proposals%rowtype;
  v_connection jsonb;
begin
  select * into v_proposal from public.memory_proposals
  where id = p_proposal_id and owner_id = v_user for update;
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;
  if v_proposal.status <> 'pending' then raise exception 'proposal_not_pending:%', v_proposal.status; end if;
  if p_kind not in ('fact', 'preference', 'goal', 'constraint', 'skill')
     or p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid_memory_fields' using errcode = '23514';
  end if;

  update public.memory_proposals set
    title = btrim(p_title), kind = p_kind, statement = btrim(p_statement),
    confidence = p_confidence, expires_at = p_expires_at
  where id = v_proposal.id returning * into v_proposal;

  delete from public.memory_proposal_connections where proposal_id = v_proposal.id;
  for v_connection in select value from jsonb_array_elements(coalesce(p_connections, '[]'::jsonb))
  loop
    perform public.validate_memory_connection(
      v_user, (v_connection->>'existing_node_id')::uuid,
      v_connection->>'relationship_type'
    );
    insert into public.memory_proposal_connections (
      owner_id, proposal_id, existing_node_id, direction,
      relationship_type, reason, confidence, selected
    ) values (
      v_user, v_proposal.id, (v_connection->>'existing_node_id')::uuid,
      v_connection->>'direction', v_connection->>'relationship_type',
      btrim(v_connection->>'reason'), (v_connection->>'confidence')::numeric,
      coalesce((v_connection->>'selected')::boolean, true)
    );
  end loop;
  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'connections', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.memory_proposal_connections c
      where c.proposal_id = v_proposal.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.resolve_memory_proposal(
  p_proposal_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_proposal public.memory_proposals%rowtype;
  v_memory public.memories%rowtype;
  v_node public.nodes%rowtype;
  v_revision public.memory_revisions%rowtype;
  v_connection public.memory_proposal_connections%rowtype;
  v_edge public.edges%rowtype;
  v_assertion public.edge_assertions%rowtype;
  v_source_message_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_edge_created boolean;
  v_assertion_created boolean;
  v_context_assertion_id uuid;
  v_connection_source uuid;
  v_connection_target uuid;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_proposal from public.memory_proposals
  where id = p_proposal_id and owner_id = v_user;
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_proposal.semantic_key, 0));
  select * into v_proposal from public.memory_proposals
  where id = p_proposal_id and owner_id = v_user for update;
  if v_proposal.status <> 'pending' then raise exception 'proposal_not_pending:%', v_proposal.status; end if;

  if not p_approve then
    update public.memory_proposals set status = 'rejected', resolved_at = now()
    where id = v_proposal.id returning * into v_proposal;
    return jsonb_build_object('status', 'rejected', 'proposal', to_jsonb(v_proposal));
  end if;

  select * into v_memory from public.memories
  where owner_id = v_user and semantic_key = v_proposal.semantic_key
  for update;
  if v_memory.node_id is not null then
    select * into v_node from public.nodes where id = v_memory.node_id for update;
  end if;

  select source_message_id into v_source_message_id
  from public.memory_proposal_sources
  where proposal_id = v_proposal.id order by created_at limit 1;

  if v_memory.node_id is null then
    insert into public.nodes(owner_id, type, title, summary)
    values(v_user, 'memory', v_proposal.title, v_proposal.statement)
    returning * into v_node;
    insert into public.memories(
      node_id, owner_id, semantic_key, kind, statement, confidence,
      expires_at, current_revision, confirmed_at
    ) values (
      v_node.id, v_user, v_proposal.semantic_key, v_proposal.kind,
      v_proposal.statement, v_proposal.confidence,
      v_proposal.expires_at, 1, now()
    ) returning * into v_memory;
    insert into public.graph_changes(
      owner_id, ai_run_id, node_id, memory_proposal_id, operation, actor,
      approval_state, reason, confidence, after_snapshot,
      idempotency_key
    ) values (
      v_user, v_proposal.ai_run_id, v_node.id, v_proposal.id,
      'create_node', 'ai', 'applied', 'Approved AI Memory proposal.',
      v_proposal.confidence,
      jsonb_build_object('node', to_jsonb(v_node), 'memory', to_jsonb(v_memory)),
      'memory-proposal:' || v_proposal.id::text || ':create'
    );
  else
    v_before := jsonb_build_object('node', to_jsonb(v_node), 'memory', to_jsonb(v_memory));
    update public.nodes set title = v_proposal.title, summary = v_proposal.statement,
      version = version + 1
    where id = v_memory.node_id returning * into v_node;
    update public.memories set kind = v_proposal.kind, statement = v_proposal.statement,
      confidence = v_proposal.confidence, expires_at = v_proposal.expires_at,
      current_revision = current_revision + 1,
      confirmed_at = now(), updated_at = now()
    where node_id = v_memory.node_id returning * into v_memory;
    insert into public.graph_changes(
      owner_id, ai_run_id, node_id, memory_proposal_id, operation, actor,
      approval_state, reason, confidence, before_snapshot, after_snapshot,
      idempotency_key
    ) values (
      v_user, v_proposal.ai_run_id, v_node.id, v_proposal.id,
      'update_node', 'ai', 'applied', 'Approved AI Memory update.',
      v_proposal.confidence, v_before,
      jsonb_build_object('node', to_jsonb(v_node), 'memory', to_jsonb(v_memory)),
      'memory-proposal:' || v_proposal.id::text || ':update'
    );
    v_context_assertion_id := public.ensure_conversation_context_edge(
      v_user, v_proposal.conversation_id, v_node.id, 'discusses',
      'This conversation updated an approved Memory.', v_proposal.ai_run_id,
      v_source_message_id,
      jsonb_build_object('memory_proposal_id', v_proposal.id),
      'memory-update:' || v_proposal.id::text
    );
  end if;

  insert into public.memory_revisions(
    owner_id, memory_node_id, revision, title, kind, statement,
    confidence, expires_at, source_ai_run_id
  ) values (
    v_user, v_memory.node_id, v_memory.current_revision, v_node.title,
    v_memory.kind, v_memory.statement, v_memory.confidence,
    v_memory.expires_at, v_proposal.ai_run_id
  ) returning * into v_revision;

  insert into public.memory_revision_sources(
    owner_id, revision_id, source_message_id, conversation_id, ai_run_id
  ) select v_user, v_revision.id, s.source_message_id,
           v_proposal.conversation_id, v_proposal.ai_run_id
    from public.memory_proposal_sources s
    where s.proposal_id = v_proposal.id;

  if v_context_assertion_id is null then
    select a.id into v_context_assertion_id
    from public.edges e join public.edge_assertions a on a.edge_id = e.id
    where e.owner_id = v_user
      and e.source_node_id = v_proposal.conversation_id
      and e.target_node_id = v_memory.node_id
      and e.relationship_type = 'produced'
      and a.origin_key = 'conversation-produced:' || v_proposal.conversation_id::text || ':' || v_memory.node_id::text
      and a.status = 'active' and a.retracted_at is null
    order by a.created_at desc limit 1;
  end if;

  for v_connection in select * from public.memory_proposal_connections
    where proposal_id = v_proposal.id and selected order by created_at
  loop
    v_connection_source := case when v_connection.direction = 'memory_to_node'
      then v_memory.node_id else v_connection.existing_node_id end;
    v_connection_target := case when v_connection.direction = 'memory_to_node'
      then v_connection.existing_node_id else v_memory.node_id end;
    select not exists (
      select 1 from public.edges e
      join public.relationship_types rt on rt.name = e.relationship_type
      where e.owner_id = v_user
        and e.relationship_type = v_connection.relationship_type
        and e.archived_at is null
        and ((e.source_node_id = v_connection_source and e.target_node_id = v_connection_target)
          or (rt.is_symmetric and e.source_node_id = v_connection_target
            and e.target_node_id = v_connection_source))
    ) into v_edge_created;
    v_edge := public.ensure_semantic_edge(
      v_user,
      v_connection_source,
      v_connection_target,
      v_connection.relationship_type
    );
    select * into v_assertion from public.edge_assertions
    where edge_id = v_edge.id and owner_id = v_user and provenance = 'ai'
      and status = 'active' and retracted_at is null
    order by created_at limit 1;
    v_assertion_created := not found;
    if v_assertion_created then
      insert into public.edge_assertions(
        owner_id, edge_id, provenance, actor_id, source_node_id,
        source_message_id, source_ai_run_id, origin_key, reason,
        confidence, source_locator, status
      ) values (
        v_user, v_edge.id, 'ai', v_user, v_memory.node_id,
        v_source_message_id, v_proposal.ai_run_id,
        'memory-proposal:' || v_proposal.id::text || ':' || v_connection.id::text,
        v_connection.reason, v_connection.confidence,
        jsonb_build_object('memory_proposal_id', v_proposal.id, 'connection_id', v_connection.id),
        'active'
      ) returning * into v_assertion;
      insert into public.graph_changes(
        owner_id, ai_run_id, node_id, edge_id, assertion_id,
        memory_proposal_id, operation, actor, approval_state, reason,
        confidence, after_snapshot, idempotency_key
      ) values (
        v_user, v_proposal.ai_run_id, v_memory.node_id, v_edge.id,
        v_assertion.id, v_proposal.id, 'create_assertion', 'ai', 'applied',
        v_connection.reason, v_connection.confidence, to_jsonb(v_assertion),
        'memory-proposal:' || v_proposal.id::text || ':connection:' || v_connection.id::text
      );
    end if;
    update public.memory_proposal_connections set
      applied_edge_id = v_edge.id, applied_assertion_id = v_assertion.id,
      edge_was_created = v_edge_created,
      assertion_was_created = v_assertion_created
    where id = v_connection.id;
  end loop;

  v_after := jsonb_build_object('node', to_jsonb(v_node), 'memory', to_jsonb(v_memory));
  update public.memory_proposals set
    status = 'approved', memory_node_id = v_memory.node_id,
    memory_was_created = (v_before is null), context_assertion_id = v_context_assertion_id,
    before_snapshot = v_before, after_snapshot = v_after, resolved_at = now()
  where id = v_proposal.id returning * into v_proposal;

  update public.memory_proposals set
    status = 'superseded', superseded_by_proposal_id = v_proposal.id,
    memory_node_id = v_memory.node_id, resolved_at = now()
  where owner_id = v_user and semantic_key = v_proposal.semantic_key
    and status = 'pending' and id <> v_proposal.id;

  return jsonb_build_object(
    'status', 'approved', 'proposal', to_jsonb(v_proposal),
    'node', to_jsonb(v_node), 'memory', to_jsonb(v_memory),
    'revision', to_jsonb(v_revision),
    'connections', coalesce((select jsonb_agg(to_jsonb(c))
      from public.memory_proposal_connections c where c.proposal_id = v_proposal.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.undo_memory_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_proposal public.memory_proposals%rowtype;
  v_memory public.memories%rowtype;
  v_before_node jsonb;
  v_before_memory jsonb;
begin
  select * into v_proposal from public.memory_proposals
  where id = p_proposal_id and owner_id = v_user for update;
  if not found then raise exception 'proposal_not_found' using errcode = 'P0002'; end if;
  if v_proposal.status <> 'approved' or v_proposal.undone_at is not null then
    raise exception 'proposal_undo_not_available';
  end if;

  update public.edge_assertions a set
    status = 'retracted', retracted_at = now(), updated_at = now()
  from public.memory_proposal_connections c
  where c.proposal_id = v_proposal.id and c.assertion_was_created
    and c.applied_assertion_id = a.id and a.owner_id = v_user
    and a.status = 'active' and a.retracted_at is null;

  update public.edge_assertions set
    status = 'retracted', retracted_at = now(), updated_at = now()
  where id = v_proposal.context_assertion_id and owner_id = v_user
    and status = 'active' and retracted_at is null;

  if v_proposal.memory_was_created then
    update public.nodes set archived_at = now(), version = version + 1
    where id = v_proposal.memory_node_id and owner_id = v_user;
  else
    v_before_node := v_proposal.before_snapshot->'node';
    v_before_memory := v_proposal.before_snapshot->'memory';
    select * into v_memory from public.memories
    where node_id = v_proposal.memory_node_id and owner_id = v_user for update;
    update public.nodes set
      title = v_before_node->>'title', summary = v_before_node->>'summary',
      version = version + 1,
      archived_at = (v_before_node->>'archived_at')::timestamptz
    where id = v_proposal.memory_node_id;
    update public.memories set
      kind = v_before_memory->>'kind', statement = v_before_memory->>'statement',
      confidence = (v_before_memory->>'confidence')::numeric,
      expires_at = (v_before_memory->>'expires_at')::timestamptz,
      current_revision = current_revision + 1,
      confirmed_at = now(), updated_at = now()
    where node_id = v_proposal.memory_node_id returning * into v_memory;
    insert into public.memory_revisions(
      owner_id, memory_node_id, revision, title, kind, statement,
      confidence, expires_at, restored_from_revision
    ) values (
      v_user, v_memory.node_id, v_memory.current_revision,
      v_before_node->>'title', v_memory.kind, v_memory.statement,
      v_memory.confidence, v_memory.expires_at,
      (v_before_memory->>'current_revision')::bigint
    );
  end if;

  update public.memory_proposals set undone_at = now()
  where id = v_proposal.id returning * into v_proposal;
  update public.graph_changes set approval_state = 'undone', undone_at = now()
  where memory_proposal_id = v_proposal.id and approval_state = 'applied';
  return jsonb_build_object('status', 'undone', 'proposal', to_jsonb(v_proposal));
end;
$$;

create or replace function public.search_memory_context(
  p_query text,
  p_limit integer default 8
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.updated_at desc), '[]'::jsonb)
  from (
    select n.id, n.title, n.summary, n.created_at, n.updated_at,
           m.semantic_key, m.kind, m.statement, m.confidence,
           m.expires_at, m.current_revision,
           greatest(
             case when n.title ilike '%' || btrim(p_query) || '%' then 8 else 0 end,
             case when m.statement ilike '%' || btrim(p_query) || '%' then 6 else 0 end,
             ts_rank_cd(to_tsvector('simple', n.title || ' ' || m.statement),
               plainto_tsquery('simple', btrim(p_query))) * 4
           ) as rank
    from public.memories m join public.nodes n on n.id = m.node_id
    where m.owner_id = auth.uid() and n.owner_id = auth.uid()
      and n.archived_at is null
      and (m.expires_at is null or m.expires_at > now())
      and (btrim(p_query) = '' or n.title ilike '%' || btrim(p_query) || '%'
        or m.statement ilike '%' || btrim(p_query) || '%'
        or to_tsvector('simple', n.title || ' ' || m.statement)
           @@ plainto_tsquery('simple', btrim(p_query)))
    order by rank desc, n.updated_at desc
    limit least(greatest(p_limit, 1), 8)
  ) r;
$$;

revoke all on function public.propose_memory(text, text, text, text, numeric, timestamptz, uuid, uuid[], jsonb) from public, anon;
revoke all on function public.update_memory_proposal(uuid, text, text, text, numeric, timestamptz, jsonb) from public, anon;
revoke all on function public.resolve_memory_proposal(uuid, boolean) from public, anon;
revoke all on function public.undo_memory_proposal(uuid) from public, anon;
revoke all on function public.search_memory_context(text, integer) from public, anon;

grant execute on function public.propose_memory(text, text, text, text, numeric, timestamptz, uuid, uuid[], jsonb) to authenticated;
grant execute on function public.update_memory_proposal(uuid, text, text, text, numeric, timestamptz, jsonb) to authenticated;
grant execute on function public.resolve_memory_proposal(uuid, boolean) to authenticated;
grant execute on function public.undo_memory_proposal(uuid) to authenticated;
grant execute on function public.search_memory_context(text, integer) to authenticated;

comment on function public.propose_memory(text, text, text, text, numeric, timestamptz, uuid, uuid[], jsonb) is
  'Creates an approval-gated Memory proposal without non-enforcing privacy labels.';
comment on function public.resolve_memory_proposal(uuid, boolean) is
  'Serializes a Memory semantic key and atomically applies the approved Memory plus selected graph connections.';

commit;

