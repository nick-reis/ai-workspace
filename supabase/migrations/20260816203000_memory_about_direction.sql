create or replace function public.normalize_memory_proposal_connection_direction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.relationship_type = 'about' then
    new.direction := 'memory_to_node';
  end if;
  return new;
end;
$$;

drop trigger if exists memory_proposal_connections_normalize_about_direction
  on public.memory_proposal_connections;
create trigger memory_proposal_connections_normalize_about_direction
before insert or update of relationship_type, direction
on public.memory_proposal_connections
for each row execute function public.normalize_memory_proposal_connection_direction();

-- Pending proposals are safe to normalize directly. Applied proposal edges are
-- repaired below without touching independent assertions on the reversed edge.
update public.memory_proposal_connections
set direction = 'memory_to_node'
where relationship_type = 'about'
  and direction = 'node_to_memory'
  and applied_edge_id is null;

do $$
declare
  item record;
  old_edge_id uuid;
  correct_edge public.edges%rowtype;
  correct_assertion public.edge_assertions%rowtype;
  created_correct_edge boolean;
  created_correct_assertion boolean;
begin
  for item in
    select
      c.*,
      p.owner_id as proposal_owner_id,
      p.ai_run_id,
      p.memory_node_id,
      p.id as memory_proposal_id
    from public.memory_proposal_connections c
    join public.memory_proposals p on p.id = c.proposal_id
    join public.nodes memory_node on memory_node.id = p.memory_node_id
      and memory_node.archived_at is null
    join public.nodes existing_node on existing_node.id = c.existing_node_id
      and existing_node.archived_at is null
    where c.relationship_type = 'about'
      and c.direction = 'node_to_memory'
      and c.applied_edge_id is not null
      and p.status = 'approved'
      and p.undone_at is null
  loop
    old_edge_id := item.applied_edge_id;
    select not exists (
      select 1 from public.edges
      where owner_id = item.proposal_owner_id
        and source_node_id = item.memory_node_id
        and target_node_id = item.existing_node_id
        and relationship_type = 'about'
        and archived_at is null
    ) into created_correct_edge;
    correct_edge := public.ensure_semantic_edge(
      item.proposal_owner_id,
      item.memory_node_id,
      item.existing_node_id,
      'about'
    );

    select * into correct_assertion
    from public.edge_assertions
    where owner_id = item.proposal_owner_id
      and edge_id = correct_edge.id
      and provenance = 'ai'
      and status = 'active'
      and retracted_at is null
    order by created_at
    limit 1;
    created_correct_assertion := not found;

    if created_correct_assertion then
      if coalesce(item.assertion_was_created, false)
        and item.applied_assertion_id is not null
      then
        update public.edge_assertions
        set edge_id = correct_edge.id,
            source_node_id = item.memory_node_id,
            reason = 'The user explicitly scoped this Memory to the selected node.',
            updated_at = now()
        where id = item.applied_assertion_id
          and owner_id = item.proposal_owner_id
        returning * into correct_assertion;
      else
        insert into public.edge_assertions(
          owner_id, edge_id, provenance, actor_id, source_node_id,
          source_ai_run_id, origin_key, reason, confidence,
          source_locator, status
        ) values (
          item.proposal_owner_id, correct_edge.id, 'ai', item.proposal_owner_id,
          item.memory_node_id, item.ai_run_id,
          'memory-direction-repair:' || item.id::text,
          'The user explicitly scoped this Memory to the selected node.',
          item.confidence,
          jsonb_build_object(
            'memory_proposal_id', item.memory_proposal_id,
            'connection_id', item.id,
            'direction_repaired', true
          ),
          'active'
        ) returning * into correct_assertion;
      end if;
    elsif coalesce(item.assertion_was_created, false)
      and item.applied_assertion_id is not null
      and item.applied_assertion_id <> correct_assertion.id
    then
      update public.edge_assertions
      set status = 'retracted', retracted_at = now(), updated_at = now()
      where id = item.applied_assertion_id
        and owner_id = item.proposal_owner_id;
    end if;

    update public.memory_proposal_connections
    set direction = 'memory_to_node',
        applied_edge_id = correct_edge.id,
        applied_assertion_id = correct_assertion.id,
        edge_was_created = created_correct_edge,
        assertion_was_created = created_correct_assertion
    where id = item.id;

    update public.graph_changes
    set edge_id = correct_edge.id,
        assertion_id = correct_assertion.id,
        reason = 'The user explicitly scoped this Memory to the selected node.',
        after_snapshot = to_jsonb(correct_assertion)
    where memory_proposal_id = item.memory_proposal_id
      and idempotency_key = 'memory-proposal:' || item.memory_proposal_id::text || ':connection:' || item.id::text;

    perform public.refresh_edge_lifecycle(old_edge_id);
    perform public.refresh_edge_lifecycle(correct_edge.id);
  end loop;
end;
$$;

comment on function public.normalize_memory_proposal_connection_direction() is
  'Enforces the Memory → about → existing node semantic direction inside Memory proposal bundles.';
