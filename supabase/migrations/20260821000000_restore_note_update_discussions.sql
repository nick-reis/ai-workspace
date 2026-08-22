begin;

-- Compensate for the overly broad 20260820020000 cleanup. Conversation
-- context is restored for existing Notes when there is direct, inspectable
-- evidence: an explicit user title mention, an approved relationship proposal,
-- or an AI-authored Note update. Selected UI context, retrieval hits, and
-- Memory revisions remain excluded.
update public.relationship_types
set description = 'A conversation substantially discusses an existing Note. Deterministic evidence may come from an explicit user title mention, an approved relationship involving the Note, or an AI-authored Note update; never from retrieval, selected UI context, or Memory revision bookkeeping.'
where name = 'discusses';

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

  if p_relationship_type = 'discusses' then
    if not exists (
      select 1 from public.nodes
      where id = p_target_node_id
        and owner_id = p_owner_id
        and type = 'note'
        and archived_at is null
    ) then
      raise exception 'automatic_discussion_requires_note';
    end if;

    -- Production already explains this exact conversation/entity pair more
    -- precisely, so do not create a parallel discussion edge.
    select assertion.id into v_assertion_id
    from public.edges edge
    join public.edge_assertions assertion on assertion.edge_id = edge.id
    where edge.owner_id = p_owner_id
      and edge.source_node_id = p_conversation_id
      and edge.target_node_id = p_target_node_id
      and edge.relationship_type = 'produced'
      and edge.archived_at is null
      and assertion.status = 'active'
      and assertion.retracted_at is null
    order by assertion.created_at
    limit 1;

    if v_assertion_id is not null then return v_assertion_id; end if;
  else
    -- If stronger creation provenance is established, retract only the
    -- deterministic system discussion support for the same pair.
    update public.edge_assertions assertion
    set status = 'retracted', retracted_at = now()
    from public.edges edge
    where assertion.edge_id = edge.id
      and assertion.owner_id = p_owner_id
      and edge.owner_id = p_owner_id
      and edge.source_node_id = p_conversation_id
      and edge.target_node_id = p_target_node_id
      and edge.relationship_type = 'discusses'
      and assertion.provenance = 'system'
      and assertion.origin_key = 'conversation-discusses:' || p_conversation_id::text || ':' || p_target_node_id::text
      and assertion.status = 'active'
      and assertion.retracted_at is null;
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

-- Restore explicit Note-title context. The legacy selected-node parameter is
-- retained only for RPC compatibility and is intentionally ignored.
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
    where id = p_source_message_id
      and conversation_id = p_conversation_id
      and owner_id = v_owner_id
      and role = 'user'
  ) then
    raise exception 'source_message_not_found' using errcode = 'P0002';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(public.resolve_explicit_node_mentions(p_text, 8))
  loop
    v_target_id := (v_item->>'id')::uuid;
    if not exists (
      select 1 from public.nodes
      where id = v_target_id
        and owner_id = v_owner_id
        and type = 'note'
        and archived_at is null
    ) then
      continue;
    end if;

    perform public.ensure_conversation_context_edge(
      v_owner_id,
      p_conversation_id,
      v_target_id,
      'discusses',
      'Explicitly mentioned by the user in this conversation.',
      null,
      p_source_message_id,
      jsonb_build_object(
        'conversation_id', p_conversation_id,
        'source_message_id', p_source_message_id,
        'match_reason', coalesce(v_item->>'match_reason', 'explicit_mention'),
        'matched_label', v_item->>'matched_label'
      ),
      'conversation-discusses:' || p_conversation_id::text || ':' || v_target_id::text
    );

    if not v_linked @> jsonb_build_array(v_target_id::text) then
      v_linked := v_linked || jsonb_build_array(v_target_id::text);
    end if;
  end loop;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'linked_node_ids', v_linked
  );
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

  if v_conversation_id is null then return new; end if;

  foreach v_target_node_id in array array[new.source_node_id, new.target_node_id]
  loop
    if not exists (
      select 1 from public.nodes
      where id = v_target_node_id
        and owner_id = new.owner_id
        and type = 'note'
        and archived_at is null
    ) then
      continue;
    end if;

    perform public.ensure_conversation_context_edge(
      new.owner_id,
      v_conversation_id,
      v_target_node_id,
      'discusses',
      'Discussed while establishing an approved ' || new.relationship_type || ' relationship.',
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

create or replace function public.ensure_ai_note_update_discussion(
  p_graph_change_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change public.graph_changes%rowtype;
  v_run public.ai_runs%rowtype;
begin
  select * into v_change
  from public.graph_changes
  where id = p_graph_change_id
    and operation = 'update_note'
    and actor = 'ai'
    and ai_run_id is not null
    and node_id is not null;

  if not found then return null; end if;

  select * into v_run
  from public.ai_runs
  where id = v_change.ai_run_id
    and owner_id = v_change.owner_id
    and conversation_id is not null;

  if not found then return null; end if;

  return public.ensure_conversation_context_edge(
    v_change.owner_id,
    v_run.conversation_id,
    v_change.node_id,
    'discusses',
    'This conversation substantially discussed an existing Note while authoring a content update.',
    v_run.id,
    v_run.request_message_id,
    jsonb_build_object(
      'conversation_id', v_run.conversation_id,
      'graph_change_id', v_change.id,
      'operation', v_change.operation,
      'approval_state_at_assertion', v_change.approval_state
    ),
    'conversation-discusses:' || v_run.conversation_id::text || ':' || v_change.node_id::text
  );
end;
$$;

create or replace function public.ai_note_update_conversation_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_ai_note_update_discussion(new.id);
  return new;
end;
$$;

drop trigger if exists graph_changes_ai_note_update_context
  on public.graph_changes;
create trigger graph_changes_ai_note_update_context
after insert on public.graph_changes
for each row
when (
  new.operation = 'update_note'
  and new.actor = 'ai'
  and new.ai_run_id is not null
  and new.node_id is not null
)
execute function public.ai_note_update_conversation_context();

-- Restore legitimate historical Note context that the broad cleanup retracted.
-- Assertions sourced only from the removed selected-context UI remain
-- retracted, as do every Memory-update bookkeeping assertion.
update public.edge_assertions assertion
set status = 'active',
    retracted_at = null,
    updated_at = now()
from public.edges edge
join public.nodes target on target.id = edge.target_node_id
where assertion.edge_id = edge.id
  and edge.relationship_type = 'discusses'
  and target.type = 'note'
  and assertion.provenance = 'system'
  and assertion.status = 'retracted'
  and assertion.retracted_at is not null
  and assertion.origin_key like 'conversation-discusses:%'
  and coalesce(assertion.source_locator->>'match_reason', '') <> 'selected_context'
  and not exists (
    select 1 from public.edge_assertions active
    where active.owner_id = assertion.owner_id
      and active.edge_id = assertion.edge_id
      and active.provenance = assertion.provenance
      and active.origin_key = assertion.origin_key
      and active.status = 'active'
      and active.retracted_at is null
  );

-- Restore direct evidence that did not already have a historical assertion.
-- Each path reconciles to the same origin key, so one conversation/Note pair
-- has one system support.
select public.ensure_ai_note_update_discussion(change.id)
from public.graph_changes change
where change.operation = 'update_note'
  and change.actor = 'ai'
  and change.ai_run_id is not null
  and change.node_id is not null;

do $$
declare
  v_proposal public.relationship_proposals%rowtype;
  v_conversation_id uuid;
  v_request_message_id uuid;
  v_target_node_id uuid;
begin
  for v_proposal in
    select * from public.relationship_proposals where status = 'approved'
  loop
    select conversation_id, request_message_id
    into v_conversation_id, v_request_message_id
    from public.ai_runs
    where id = v_proposal.ai_run_id and owner_id = v_proposal.owner_id;

    if v_conversation_id is null then continue; end if;

    foreach v_target_node_id in array array[v_proposal.source_node_id, v_proposal.target_node_id]
    loop
      if exists (
        select 1 from public.nodes
        where id = v_target_node_id
          and owner_id = v_proposal.owner_id
          and type = 'note'
          and archived_at is null
      ) then
        perform public.ensure_conversation_context_edge(
          v_proposal.owner_id,
          v_conversation_id,
          v_target_node_id,
          'discusses',
          'Discussed while establishing an approved ' || v_proposal.relationship_type || ' relationship.',
          v_proposal.ai_run_id,
          coalesce(v_proposal.source_message_id, v_request_message_id),
          jsonb_build_object(
            'conversation_id', v_conversation_id,
            'proposal_id', v_proposal.id,
            'relationship_type', v_proposal.relationship_type,
            'semantic_key', v_proposal.semantic_key,
            'backfilled', true
          ),
          'conversation-discusses:' || v_conversation_id::text || ':' || v_target_node_id::text
        );
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.ensure_conversation_context_edge(
  uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function public.relationship_proposal_conversation_context()
  from public, anon, authenticated;
revoke all on function public.ensure_ai_note_update_discussion(uuid)
  from public, anon, authenticated;
revoke all on function public.ai_note_update_conversation_context()
  from public, anon, authenticated;
revoke all on function public.record_conversation_context(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.record_conversation_context(uuid, uuid, text, uuid)
  to authenticated;

comment on function public.ensure_conversation_context_edge(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text) is
  'Reconciles deterministic conversation context and prefers produced over discusses for the same conversation/entity pair.';
comment on function public.record_conversation_context(uuid, uuid, text, uuid) is
  'Creates idempotent discussion support for explicit user mentions of existing Notes; selected UI context is ignored.';
comment on function public.ensure_ai_note_update_discussion(uuid) is
  'Creates idempotent discussion support from an authoritative AI update_note graph change targeting an existing Note.';

commit;
