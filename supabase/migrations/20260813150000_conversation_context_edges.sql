-- Make durable conversations visible around the graph changes they caused.
-- These edges are deterministic bookkeeping, not model-inferred semantics.

insert into public.relationship_types (
  name, label, inverse_label, description, is_symmetric,
  allowed_source_types, allowed_target_types,
  is_hierarchical, must_be_acyclic, allows_self_reference
)
values
  (
    'discusses', 'Discusses', 'Discussed in',
    'A durable conversation materially discussed or changed the target entity.',
    false, array['conversation'], array['note', 'project', 'topic', 'person'],
    false, false, false
  ),
  (
    'produced', 'Produced', 'Produced in',
    'A durable conversation directly caused the AI to create the target entity.',
    false, array['conversation'], array['note', 'project', 'topic', 'person'],
    false, false, false
  )
on conflict (name) do update
set label = excluded.label,
    inverse_label = excluded.inverse_label,
    description = excluded.description,
    is_symmetric = excluded.is_symmetric,
    allowed_source_types = excluded.allowed_source_types,
    allowed_target_types = excluded.allowed_target_types,
    is_hierarchical = excluded.is_hierarchical,
    must_be_acyclic = excluded.must_be_acyclic,
    allows_self_reference = excluded.allows_self_reference;

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

create or replace function public.relationship_proposal_conversation_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_request_message_id uuid;
  v_target_node_id uuid;
begin
  select conversation_id, request_message_id
  into v_conversation_id, v_request_message_id
  from public.ai_runs
  where id = new.ai_run_id and owner_id = new.owner_id;

  if v_conversation_id is null then
    return new;
  end if;

  foreach v_target_node_id in array array[new.source_node_id, new.target_node_id]
  loop
    if not exists (
      select 1 from public.nodes
      where id = v_target_node_id
        and owner_id = new.owner_id
        and type in ('note', 'project', 'topic', 'person')
        and archived_at is null
    ) then
      continue;
    end if;

    -- A direct production relationship is more specific than discusses, so do
    -- not add both edges from the same conversation to the same entity.
    if not exists (
      select 1
      from public.edges e
      join public.edge_assertions a on a.edge_id = e.id
      where e.owner_id = new.owner_id
        and e.source_node_id = v_conversation_id
        and e.target_node_id = v_target_node_id
        and e.relationship_type = 'produced'
        and e.archived_at is null
        and a.status = 'active'
        and a.retracted_at is null
    ) then
      perform public.ensure_conversation_context_edge(
        new.owner_id,
        v_conversation_id,
        v_target_node_id,
        'discusses',
        'Discussed while requesting ' || new.relationship_type || ' between ' ||
          new.source_node_id::text || ' and ' || new.target_node_id::text,
        new.ai_run_id,
        coalesce(new.source_message_id, v_request_message_id),
        jsonb_build_object(
          'conversation_id', v_conversation_id,
          'proposal_id', new.id,
          'relationship_type', new.relationship_type,
          'semantic_key', new.semantic_key
        ),
        'conversation-discusses:' || v_conversation_id::text || ':' || v_target_node_id::text
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists relationship_proposals_context_after_insert
  on public.relationship_proposals;
create trigger relationship_proposals_context_after_insert
after insert on public.relationship_proposals
for each row
when (new.status = 'approved')
execute function public.relationship_proposal_conversation_context();

drop trigger if exists relationship_proposals_context_after_approval
  on public.relationship_proposals;
create trigger relationship_proposals_context_after_approval
after update of status on public.relationship_proposals
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function public.relationship_proposal_conversation_context();

create or replace function public.ai_created_node_conversation_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_request_message_id uuid;
begin
  select conversation_id, request_message_id
  into v_conversation_id, v_request_message_id
  from public.ai_runs
  where id = new.ai_run_id and owner_id = new.owner_id;

  if v_conversation_id is null or new.node_id is null then
    return new;
  end if;

  perform public.ensure_conversation_context_edge(
    new.owner_id,
    v_conversation_id,
    new.node_id,
    'produced',
    'Created by the AI during this conversation.',
    new.ai_run_id,
    v_request_message_id,
    jsonb_build_object(
      'conversation_id', v_conversation_id,
      'graph_change_id', new.id,
      'operation', new.operation
    ),
    'conversation-produced:' || v_conversation_id::text || ':' || new.node_id::text
  );

  return new;
end;
$$;

drop trigger if exists graph_changes_ai_created_node_context
  on public.graph_changes;
create trigger graph_changes_ai_created_node_context
after insert on public.graph_changes
for each row
when (
  new.operation = 'create_node'
  and new.actor = 'ai'
  and new.ai_run_id is not null
  and new.node_id is not null
)
execute function public.ai_created_node_conversation_context();

revoke all on function public.ensure_conversation_context_edge(
  uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function public.relationship_proposal_conversation_context()
  from public, anon, authenticated;
revoke all on function public.ai_created_node_conversation_context()
  from public, anon, authenticated;

comment on function public.relationship_proposal_conversation_context() is
  'Deterministically links an approving conversation to relationship endpoints without treating retrieval as durable knowledge.';
comment on function public.ai_created_node_conversation_context() is
  'Deterministically links an AI-created entity back to the conversation that produced it.';
