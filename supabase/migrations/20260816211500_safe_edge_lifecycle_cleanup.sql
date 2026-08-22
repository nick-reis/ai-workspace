create or replace function public.refresh_edge_lifecycle(assertion_edge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Updating an edge invokes validate_edge, which intentionally requires both
  -- endpoints to be active. During archive cleanup or cascading deletion an
  -- endpoint may already be archived/disappearing, so there is no lifecycle
  -- state left to refresh. Skipping that transient update lets the owning
  -- archive/delete operation finish without weakening edge validation.
  update public.edges e
  set archived_at = case
      when exists (
        select 1 from public.edge_assertions a
        where a.edge_id = assertion_edge_id
          and a.status = 'active'
          and a.retracted_at is null
      ) then null
      else coalesce(e.archived_at, now())
    end,
    updated_at = now()
  where e.id = assertion_edge_id
    and exists (
      select 1 from public.nodes source_node
      where source_node.id = e.source_node_id
        and source_node.owner_id = e.owner_id
        and source_node.archived_at is null
    )
    and exists (
      select 1 from public.nodes target_node
      where target_node.id = e.target_node_id
        and target_node.owner_id = e.owner_id
        and target_node.archived_at is null
    );
end;
$$;

revoke all on function public.refresh_edge_lifecycle(uuid)
  from public, anon, authenticated;

comment on function public.refresh_edge_lifecycle(uuid) is
  'Refreshes an edge only while both owned endpoints are active; archive/delete cleanup otherwise owns the lifecycle transition.';
