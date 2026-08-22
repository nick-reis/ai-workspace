begin;

create or replace function public.memory_proposal_origin_connection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_message_id uuid;
  v_assertion_id uuid;
  v_relationship_type text;
begin
  if new.status <> 'approved'
     or old.status = 'approved'
     or new.memory_node_id is null then
    return new;
  end if;

  select source_message_id into v_source_message_id
  from public.memory_proposal_sources
  where proposal_id = new.id and owner_id = new.owner_id
  order by created_at
  limit 1;

  v_relationship_type := case when new.action = 'create' then 'produced' else 'discusses' end;
  v_assertion_id := public.ensure_conversation_context_edge(
    new.owner_id,
    new.conversation_id,
    new.memory_node_id,
    v_relationship_type,
    case when new.action = 'create'
      then 'This conversation produced an approved Memory.'
      else 'This conversation updated an approved Memory.'
    end,
    new.ai_run_id,
    v_source_message_id,
    jsonb_build_object('memory_proposal_id', new.id, 'automatic', true),
    case when new.action = 'create'
      then 'conversation-produced:' || new.conversation_id::text || ':' || new.memory_node_id::text
      else 'memory-update:' || new.id::text
    end
  );

  update public.memory_proposals
  set context_assertion_id = v_assertion_id
  where id = new.id and owner_id = new.owner_id;

  return new;
end;
$$;

drop trigger if exists memory_proposal_origin_connection_trigger on public.memory_proposals;
create trigger memory_proposal_origin_connection_trigger
after update of status on public.memory_proposals
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function public.memory_proposal_origin_connection();

-- Repair approved Memory creations using their exact proposal, conversation,
-- AI run, and source-message provenance. No inferred historical links are added.
do $$
declare
  v_proposal record;
  v_source_message_id uuid;
  v_assertion_id uuid;
begin
  for v_proposal in
    select mp.*
    from public.memory_proposals mp
    join public.nodes n
      on n.id = mp.memory_node_id
     and n.owner_id = mp.owner_id
     and n.type = 'memory'
     and n.archived_at is null
    where mp.status = 'approved'
      and mp.action = 'create'
      and mp.undone_at is null
  loop
    select source_message_id into v_source_message_id
    from public.memory_proposal_sources
    where proposal_id = v_proposal.id and owner_id = v_proposal.owner_id
    order by created_at
    limit 1;

    v_assertion_id := public.ensure_conversation_context_edge(
      v_proposal.owner_id,
      v_proposal.conversation_id,
      v_proposal.memory_node_id,
      'produced',
      'This conversation produced an approved Memory.',
      v_proposal.ai_run_id,
      v_source_message_id,
      jsonb_build_object('memory_proposal_id', v_proposal.id, 'automatic', true, 'backfilled', true),
      'conversation-produced:' || v_proposal.conversation_id::text || ':' || v_proposal.memory_node_id::text
    );

    update public.memory_proposals
    set context_assertion_id = v_assertion_id
    where id = v_proposal.id and owner_id = v_proposal.owner_id;
  end loop;
end;
$$;

revoke all on function public.memory_proposal_origin_connection() from public, anon, authenticated;

comment on function public.memory_proposal_origin_connection() is
  'Creates the deterministic originating-conversation context assertion in the same transaction that approves a Memory proposal.';

commit;
