begin;

create or replace function public.get_conversation_summary(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'conversation', to_jsonb(c),
    'node', to_jsonb(n),
    'summary', case when cs.conversation_id is null then null else to_jsonb(cs) end,
    'latest_message_sequence', latest.sequence,
    'needs_refresh', case
      when latest.sequence is null then false
      when cs.conversation_id is null then true
      else latest.sequence > coalesce(cs.through_message_sequence, 0)
    end
  )
  from public.conversations c
  join public.nodes n on n.id = c.node_id and n.owner_id = auth.uid()
  left join public.conversation_summaries cs on cs.conversation_id = c.node_id
  left join lateral (
    select m.sequence
    from public.messages m
    where m.conversation_id = c.node_id and m.owner_id = auth.uid()
    order by m.sequence desc
    limit 1
  ) latest on true
  where c.node_id = p_conversation_id and c.owner_id = auth.uid();
$$;

comment on function public.get_conversation_summary(uuid) is
  'Returns explicit cursor-based freshness. Node updated_at remains general retrieval metadata and never causes summary regeneration by itself.';

commit;
