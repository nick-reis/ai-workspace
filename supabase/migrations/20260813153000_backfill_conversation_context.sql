begin;

-- Production is more specific than discussion. If a provable production link is
-- added later (including by this backfill), remove only the deterministic system
-- discussion support for the same conversation/entity pair.
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
  if p_relationship_type not in ('discusses', 'produced') then
    raise exception 'invalid_conversation_context_relationship';
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

  if p_relationship_type = 'produced' then
    update public.edge_assertions a
    set status = 'retracted', retracted_at = now()
    from public.edges e
    where a.edge_id = e.id
      and a.owner_id = p_owner_id
      and e.owner_id = p_owner_id
      and e.source_node_id = p_conversation_id
      and e.target_node_id = p_target_node_id
      and e.relationship_type = 'discusses'
      and a.provenance = 'system'
      and a.origin_key = 'conversation-discusses:' || p_conversation_id::text || ':' || p_target_node_id::text
      and a.status = 'active'
      and a.retracted_at is null;
  end if;

  v_edge := public.ensure_semantic_edge(
    p_owner_id,
    p_conversation_id,
    p_target_node_id,
    p_relationship_type
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

-- Reconcile only history with direct provenance. We deliberately do not infer a
-- producing conversation from timestamps, titles, or semantic similarity.
do $$
declare
  v_change record;
  v_proposal record;
  v_target_node_id uuid;
begin
  for v_change in
    select gc.id, gc.owner_id, gc.node_id, gc.ai_run_id,
           ar.conversation_id, ar.request_message_id, gc.operation
    from public.graph_changes gc
    join public.ai_runs ar
      on ar.id = gc.ai_run_id and ar.owner_id = gc.owner_id
    join public.nodes n
      on n.id = gc.node_id and n.owner_id = gc.owner_id
    where gc.operation = 'create_node'
      and gc.actor = 'ai'
      and gc.ai_run_id is not null
      and gc.node_id is not null
      and ar.conversation_id is not null
      and n.type in ('note', 'project', 'topic', 'person')
      and n.archived_at is null
  loop
    perform public.ensure_conversation_context_edge(
      v_change.owner_id,
      v_change.conversation_id,
      v_change.node_id,
      'produced',
      'Created by the AI during this conversation.',
      v_change.ai_run_id,
      v_change.request_message_id,
      jsonb_build_object(
        'conversation_id', v_change.conversation_id,
        'graph_change_id', v_change.id,
        'operation', v_change.operation,
        'backfilled', true
      ),
      'conversation-produced:' || v_change.conversation_id::text || ':' || v_change.node_id::text
    );
  end loop;

  for v_proposal in
    select rp.*, ar.conversation_id,
           coalesce(rp.source_message_id, ar.request_message_id) as context_message_id
    from public.relationship_proposals rp
    join public.ai_runs ar
      on ar.id = rp.ai_run_id and ar.owner_id = rp.owner_id
    where rp.status = 'approved'
      and ar.conversation_id is not null
  loop
    foreach v_target_node_id in array array[v_proposal.source_node_id, v_proposal.target_node_id]
    loop
      if exists (
        select 1 from public.nodes
        where id = v_target_node_id
          and owner_id = v_proposal.owner_id
          and type in ('note', 'project', 'topic', 'person')
          and archived_at is null
      ) and not exists (
        select 1
        from public.edges e
        join public.edge_assertions a on a.edge_id = e.id
        where e.owner_id = v_proposal.owner_id
          and e.source_node_id = v_proposal.conversation_id
          and e.target_node_id = v_target_node_id
          and e.relationship_type = 'produced'
          and e.archived_at is null
          and a.status = 'active'
          and a.retracted_at is null
      ) then
        perform public.ensure_conversation_context_edge(
          v_proposal.owner_id,
          v_proposal.conversation_id,
          v_target_node_id,
          'discusses',
          'Discussed while requesting ' || v_proposal.relationship_type || ' between ' ||
            v_proposal.source_node_id::text || ' and ' || v_proposal.target_node_id::text,
          v_proposal.ai_run_id,
          v_proposal.context_message_id,
          jsonb_build_object(
            'conversation_id', v_proposal.conversation_id,
            'proposal_id', v_proposal.id,
            'relationship_type', v_proposal.relationship_type,
            'semantic_key', v_proposal.semantic_key,
            'backfilled', true
          ),
          'conversation-discusses:' || v_proposal.conversation_id::text || ':' || v_target_node_id::text
        );
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.ensure_conversation_context_edge(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text) is
  'Creates idempotent conversation context and prefers the more specific produced relationship over deterministic discusses support.';

commit;
