create or replace function public.resolve_graph_change(
  p_change_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  change_row public.graph_changes%rowtype;
  before_note public.notes%rowtype;
  after_note public.notes%rowtype;
  before_assertion public.edge_assertions%rowtype;
  after_assertion public.edge_assertions%rowtype;
  expected_version bigint;
begin
  select * into change_row from public.graph_changes
  where id = p_change_id and owner_id = owner and approval_state = 'proposed';
  if change_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  if not p_approve then
    update public.graph_changes set approval_state = 'rejected' where id = p_change_id;
    return jsonb_build_object('change_id', p_change_id, 'status', 'rejected');
  end if;

  if change_row.operation = 'update_note' then
    select * into before_note from public.notes where node_id = change_row.node_id and owner_id = owner;
    expected_version := (change_row.after_snapshot->>'expected_content_version')::bigint;
    if before_note.node_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    if before_note.content_version <> expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
    update public.notes set
      markdown = change_row.after_snapshot->>'markdown',
      content_version = content_version + 1,
      parsed_at = null
    where node_id = change_row.node_id returning * into after_note;
    perform public.reconcile_note_links(
      change_row.node_id,
      coalesce(change_row.after_snapshot->'links', '[]'::jsonb)
    );
    update public.graph_changes set
      approval_state = 'applied',
      before_snapshot = to_jsonb(before_note),
      after_snapshot = to_jsonb(after_note)
    where id = p_change_id;
  elsif change_row.operation = 'retract_assertion' then
    select * into before_assertion from public.edge_assertions
    where id = change_row.assertion_id and owner_id = owner and retracted_at is null;
    if before_assertion.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.edge_assertions set status = 'retracted', retracted_at = now(), reason = coalesce(change_row.reason, reason)
    where id = before_assertion.id returning * into after_assertion;
    update public.graph_changes set
      approval_state = 'applied',
      before_snapshot = to_jsonb(before_assertion),
      after_snapshot = to_jsonb(after_assertion)
    where id = p_change_id;
  else
    raise exception 'unsupported_proposal' using errcode = '0A000';
  end if;

  return jsonb_build_object('change_id', p_change_id, 'status', 'applied');
end;
$$;

grant execute on function public.resolve_graph_change(uuid, boolean) to authenticated;

