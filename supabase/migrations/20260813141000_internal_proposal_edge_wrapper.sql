-- Internal overload used by the proposal resolver. The four-argument edge
-- function remains the canonical implementation and still performs validation.
create or replace function public.ensure_semantic_edge(
  p_source_node_id uuid,
  p_target_node_id uuid,
  p_relationship_type text
)
returns public.edges
language sql
security definer
set search_path = public
as $$
  select public.ensure_semantic_edge(
    auth.uid(),
    p_source_node_id,
    p_target_node_id,
    p_relationship_type
  );
$$;

revoke all on function public.ensure_semantic_edge(uuid, uuid, text)
  from public, anon, authenticated;

comment on function public.ensure_semantic_edge(uuid, uuid, text) is
  'Private authenticated-owner wrapper for transactional relationship proposal resolution.';

