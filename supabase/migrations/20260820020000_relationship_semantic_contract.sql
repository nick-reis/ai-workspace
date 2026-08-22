begin;

-- A graph edge is a durable semantic claim, not an interaction log. Creation
-- provenance remains useful as `produced`; mentions, retrieval, relationship
-- requests, and mutations already have normalized audit/provenance records.
update public.relationship_types
set description = 'A conversation substantially analyzes an existing entity as subject matter. Never inferred from a mention, retrieval, selected context, relationship request, or mutation.'
where name = 'discusses';

update public.relationship_types
set description = 'A conversation directly caused a new durable entity to be created. Never used for updates or discussion.'
where name = 'produced';

-- Stop every automatic discussion path. Explicitly reviewed/user-authored
-- assertions remain valid history; only deterministic system bookkeeping is
-- retracted below.
drop trigger if exists relationship_proposals_context_after_insert
  on public.relationship_proposals;
drop trigger if exists relationship_proposals_context_after_approval
  on public.relationship_proposals;
drop trigger if exists memory_proposal_origin_connection_trigger
  on public.memory_proposals;

drop function if exists public.relationship_proposal_conversation_context();
drop function if exists public.memory_proposal_origin_connection();
drop function if exists public.record_conversation_context(uuid, uuid, text, uuid);

create or replace function public.ensure_conversation_context_edge(
  p_owner_id uuid,
  p_conversation_id uuid,
  p_target_node_id uuid,
  p_relationship_type text,
  p_reason text,
  p_ai_run_id uuid,
  p_source_message_id uuid,
  p_source_locator jsonb,
  p_origin_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edge public.edges%rowtype;
  v_assertion_id uuid;
begin
  if p_relationship_type <> 'produced' then
    raise exception 'automatic_relationship_not_allowed:%', p_relationship_type;
  end if;

  if not exists (
    select 1 from public.nodes
    where id = p_conversation_id
      and owner_id = p_owner_id
      and type = 'conversation'
      and archived_at is null
  ) then
    raise exception 'conversation_not_found';
  end if;

  v_edge := public.ensure_semantic_edge(
    p_owner_id,
    p_conversation_id,
    p_target_node_id,
    'produced'
  );

  insert into public.edge_assertions as existing (
    owner_id, edge_id, provenance, actor_id, source_node_id,
    source_message_id, source_ai_run_id, origin_key, reason, source_locator,
    status
  ) values (
    p_owner_id, v_edge.id, 'system', p_owner_id, p_conversation_id,
    p_source_message_id, p_ai_run_id, p_origin_key, p_reason,
    coalesce(p_source_locator, '{}'::jsonb), 'active'
  )
  on conflict (owner_id, edge_id, provenance, origin_key)
    where retracted_at is null and origin_key is not null
  do update set
    source_message_id = excluded.source_message_id,
    source_ai_run_id = excluded.source_ai_run_id,
    reason = excluded.reason,
    source_locator = existing.source_locator || excluded.source_locator,
    status = 'active',
    updated_at = now()
  returning id into v_assertion_id;

  return v_assertion_id;
end;
$$;

-- Resolve Memory changes without fabricating a conversation relationship.
-- memory_revision_sources is the authoritative link from each revision to its
-- messages, conversation, and AI run. The graph_changes row remains the audit
-- event. A newly created Memory still receives `produced` through the existing
-- AI create-node graph-change trigger.
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

    -- The graph-change trigger above creates the deterministic `produced`
    -- assertion synchronously. Only a newly created Memory may retain that
    -- assertion as proposal context; an update must never claim an earlier
    -- creation assertion, even when it happens in the same conversation.
    select a.id into v_context_assertion_id
    from public.edges e join public.edge_assertions a on a.edge_id = e.id
    where e.owner_id = v_user
      and e.source_node_id = v_proposal.conversation_id
      and e.target_node_id = v_memory.node_id
      and e.relationship_type = 'produced'
      and a.origin_key = 'conversation-produced:' || v_proposal.conversation_id::text || ':' || v_memory.node_id::text
      and a.status = 'active' and a.retracted_at is null
    order by a.created_at desc limit 1;
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

-- Retract only bookkeeping assertions the application created automatically.
-- Independently authored `discusses` support remains untouched.
update public.edge_assertions assertion
set status = 'retracted',
    retracted_at = now(),
    updated_at = now()
from public.edges edge
where assertion.edge_id = edge.id
  and edge.relationship_type = 'discusses'
  and assertion.provenance = 'system'
  and assertion.status = 'active'
  and assertion.retracted_at is null
  and (
    assertion.origin_key like 'conversation-discusses:%'
    or assertion.origin_key like 'memory-update:%'
  );

comment on function public.resolve_memory_proposal(uuid, boolean) is
  'Approves or rejects a sourced Memory proposal. Updates remain in revision/audit provenance and never fabricate a semantic conversation edge.';

comment on function public.ensure_conversation_context_edge(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text) is
  'Internal creation-provenance helper. New callers must use produced only; discusses is never automatic.';

commit;
