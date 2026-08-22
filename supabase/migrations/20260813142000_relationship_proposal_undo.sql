alter table public.relationship_proposals
  add column if not exists undone_at timestamptz;

create or replace function public.undo_relationship_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_proposal public.relationship_proposals%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_proposal
  from public.relationship_proposals
  where id = p_proposal_id and owner_id = v_user
  for update;

  if not found then
    raise exception 'proposal_not_found';
  end if;
  if v_proposal.status <> 'approved'
     or not coalesce(v_proposal.assertion_was_created, false)
     or v_proposal.assertion_id is null
     or v_proposal.undone_at is not null then
    raise exception 'proposal_undo_not_available';
  end if;

  update public.edge_assertions
  set status = 'retracted', retracted_at = now(), updated_at = now()
  where id = v_proposal.assertion_id
    and owner_id = v_user
    and provenance = 'ai'
    and status = 'active'
    and retracted_at is null;

  if not found then
    raise exception 'assertion_not_active';
  end if;

  update public.relationship_proposals
  set undone_at = now()
  where id = v_proposal.id
  returning * into v_proposal;

  update public.graph_changes
  set approval_state = 'undone', undone_at = now()
  where proposal_id = v_proposal.id and approval_state = 'applied';

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'status', 'undone',
    'retracted_assertion_id', v_proposal.assertion_id
  );
end;
$$;

create or replace function public.get_activity_feed(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with proposal_items as (
    select rp.created_at,
           jsonb_build_object(
             'kind', 'relationship_proposal',
             'id', rp.id,
             'status', rp.status,
             'source_node_id', rp.source_node_id,
             'source_title', source_node.title,
             'target_node_id', rp.target_node_id,
             'target_title', target_node.title,
             'relationship_type', rp.relationship_type,
             'reason', rp.reason,
             'confidence', rp.confidence,
             'ai_run_id', rp.ai_run_id,
             'conversation_id', ar.conversation_id,
             'edge_id', rp.edge_id,
             'assertion_id', rp.assertion_id,
             'superseded_by_proposal_id', rp.superseded_by_proposal_id,
             'edge_was_created', rp.edge_was_created,
             'assertion_was_created', rp.assertion_was_created,
             'created_at', rp.created_at,
             'resolved_at', rp.resolved_at,
             'undone_at', rp.undone_at
           ) as item
    from public.relationship_proposals rp
    join public.nodes source_node on source_node.id = rp.source_node_id
    join public.nodes target_node on target_node.id = rp.target_node_id
    join public.ai_runs ar on ar.id = rp.ai_run_id
    where rp.owner_id = auth.uid()
  ),
  change_items as (
    select gc.created_at,
           jsonb_build_object(
             'kind', 'graph_change',
             'id', gc.id,
             'operation', gc.operation,
             'approval_state', gc.approval_state,
             'actor', gc.actor,
             'reason', gc.reason,
             'confidence', gc.confidence,
             'before_snapshot', gc.before_snapshot,
             'after_snapshot', gc.after_snapshot,
             'idempotency_key', gc.idempotency_key,
             'node_id', gc.node_id,
             'edge_id', gc.edge_id,
             'assertion_id', gc.assertion_id,
             'ai_run_id', gc.ai_run_id,
             'created_at', gc.created_at,
             'undone_at', gc.undone_at
           ) as item
    from public.graph_changes gc
    where gc.owner_id = auth.uid()
      and gc.proposal_id is null
  )
  select coalesce(jsonb_agg(items.item order by items.created_at desc), '[]'::jsonb)
  from (
    select * from proposal_items
    union all
    select * from change_items
    order by created_at desc
    limit least(p_limit, 100)
  ) items;
$$;

revoke all on function public.undo_relationship_proposal(uuid) from public, anon;
grant execute on function public.undo_relationship_proposal(uuid) to authenticated;

comment on function public.undo_relationship_proposal(uuid) is
  'Retracts only the active AI assertion created by the approved proposal; reused support cannot be undone here.';

