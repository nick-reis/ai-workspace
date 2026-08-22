begin;

create or replace function public.update_entity(
  p_node_id uuid,
  p_title text,
  p_summary text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  before_row public.nodes%rowtype;
  after_row public.nodes%rowtype;
begin
  select * into before_row from public.nodes
  where id = p_node_id and owner_id = owner and archived_at is null;
  if before_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if before_row.type = 'memory' then
    raise exception 'memory_update_requires_typed_proposal' using errcode = '42501';
  end if;
  if before_row.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  update public.nodes set title = btrim(p_title),
    summary = nullif(btrim(p_summary), ''), version = version + 1
  where id = p_node_id returning * into after_row;
  insert into public.graph_changes(
    owner_id, node_id, operation, actor, before_snapshot, after_snapshot
  ) values (
    owner, p_node_id, 'update_node', 'user', to_jsonb(before_row), to_jsonb(after_row)
  );
  return to_jsonb(after_row);
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
      sensitivity = v_before_memory->>'sensitivity',
      expires_at = (v_before_memory->>'expires_at')::timestamptz,
      current_revision = current_revision + 1,
      confirmed_at = now(), updated_at = now()
    where node_id = v_proposal.memory_node_id returning * into v_memory;
    insert into public.memory_revisions(
      owner_id, memory_node_id, revision, title, kind, statement,
      confidence, sensitivity, expires_at, restored_from_revision
    ) values (
      v_user, v_memory.node_id, v_memory.current_revision,
      v_before_node->>'title', v_memory.kind, v_memory.statement,
      v_memory.confidence, v_memory.sensitivity, v_memory.expires_at,
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

comment on function public.update_entity(uuid, text, text, bigint) is
  'Updates generic node details except Memory, whose canonical statement requires the typed approval lifecycle.';

commit;
