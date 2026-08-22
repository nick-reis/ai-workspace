create or replace function public.delete_entity_permanently(
  p_node_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  target public.nodes%rowtype;
  connected_edge_ids uuid[] := array[]::uuid[];
  connected_assertion_ids uuid[] := array[]::uuid[];
  related_proposal_ids uuid[] := array[]::uuid[];
  related_memory_proposal_ids uuid[] := array[]::uuid[];
  conversation_run_ids uuid[] := array[]::uuid[];
begin
  if owner is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into target from public.nodes
  where id = p_node_id and owner_id = owner;
  if target.id is null then
    raise exception 'Entity not found' using errcode = 'P0002';
  end if;
  if p_confirmation is distinct from 'DELETE' then
    raise exception 'Deletion confirmation is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('delete-entity:' || owner::text || ':' || target.id::text, 0));

  select coalesce(array_agg(id), array[]::uuid[]) into connected_edge_ids
  from public.edges where owner_id = owner
    and (source_node_id = target.id or target_node_id = target.id);
  select coalesce(array_agg(id), array[]::uuid[]) into connected_assertion_ids
  from public.edge_assertions where owner_id = owner
    and edge_id = any(connected_edge_ids);
  select coalesce(array_agg(id), array[]::uuid[]) into related_proposal_ids
  from public.relationship_proposals where owner_id = owner
    and (source_node_id = target.id or target_node_id = target.id);
  select coalesce(array_agg(id), array[]::uuid[]) into related_memory_proposal_ids
  from public.memory_proposals where owner_id = owner
    and (memory_node_id = target.id or existing_memory_node_id = target.id);

  if target.type = 'conversation' then
    select coalesce(array_agg(id), array[]::uuid[]) into conversation_run_ids
    from public.ai_runs where owner_id = owner and conversation_id = target.id;
  end if;

  delete from public.graph_changes
  where owner_id = owner and (
    node_id = target.id
    or edge_id = any(connected_edge_ids)
    or assertion_id = any(connected_assertion_ids)
    or proposal_id = any(related_proposal_ids)
    or memory_proposal_id = any(related_memory_proposal_ids)
    or ai_run_id = any(conversation_run_ids)
  );

  if cardinality(conversation_run_ids) > 0 then
    delete from public.ai_runs
    where owner_id = owner and id = any(conversation_run_ids);
  end if;
  delete from public.relationship_proposals
  where owner_id = owner and id = any(related_proposal_ids);
  delete from public.memory_proposals
  where owner_id = owner and id = any(related_memory_proposal_ids);
  delete from public.edge_assertions
  where owner_id = owner and id = any(connected_assertion_ids);
  delete from public.edges
  where owner_id = owner and id = any(connected_edge_ids);
  delete from public.nodes
  where id = target.id and owner_id = owner;

  return jsonb_build_object(
    'deleted_node_id', target.id,
    'deleted_title', target.title,
    'deleted_type', target.type,
    'deleted_edges', cardinality(connected_edge_ids),
    'account_preserved', true
  );
end;
$$;

comment on function public.delete_entity_permanently(uuid, text) is
  'Permanently deletes one caller-owned entity and its connected graph records after an explicit confirmation action.';
