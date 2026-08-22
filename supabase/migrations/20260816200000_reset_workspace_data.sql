create or replace function public.reset_workspace_data(p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  deleted_nodes integer;
  deleted_conversations integer;
  deleted_messages integer;
  deleted_memories integer;
  deleted_edges integer;
  deleted_ai_runs integer;
  deleted_graph_changes integer;
begin
  if owner is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_confirmation is distinct from 'RESET' then
    raise exception 'Type RESET to confirm workspace deletion' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reset-workspace:' || owner::text, 0));

  select count(*)::integer into deleted_nodes from public.nodes where owner_id = owner;
  select count(*)::integer into deleted_conversations from public.conversations where owner_id = owner;
  select count(*)::integer into deleted_messages from public.messages where owner_id = owner;
  select count(*)::integer into deleted_memories from public.memories where owner_id = owner;
  select count(*)::integer into deleted_edges from public.edges where owner_id = owner;
  select count(*)::integer into deleted_ai_runs from public.ai_runs where owner_id = owner;
  select count(*)::integer into deleted_graph_changes from public.graph_changes where owner_id = owner;

  -- Audit rows are intentionally cleared as part of the test reset. AI runs
  -- cascade their proposal records; deleting nodes then cascades every typed
  -- extension, message, edge, assertion, embedding, and unresolved link.
  delete from public.graph_changes where owner_id = owner;
  delete from public.ai_runs where owner_id = owner;
  delete from public.nodes where owner_id = owner;

  return jsonb_build_object(
    'deleted_nodes', deleted_nodes,
    'deleted_conversations', deleted_conversations,
    'deleted_messages', deleted_messages,
    'deleted_memories', deleted_memories,
    'deleted_edges', deleted_edges,
    'deleted_ai_runs', deleted_ai_runs,
    'deleted_graph_changes', deleted_graph_changes,
    'profile_preserved', true
  );
end;
$$;

revoke all on function public.reset_workspace_data(text) from public, anon;
grant execute on function public.reset_workspace_data(text) to authenticated;

comment on function public.reset_workspace_data(text) is
  'Permanently deletes all workspace data owned by the authenticated caller while preserving auth and profile records.';
