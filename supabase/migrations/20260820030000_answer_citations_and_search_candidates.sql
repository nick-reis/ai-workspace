begin;

-- Response evidence distinguishes retrieval candidates from entities actually
-- loaded, traversed, changed, or cited. The JSON stored on messages remains an
-- immutable snapshot of IDs/ranks; this reader resolves only owner-scoped rows.
create or replace function public.get_message_evidence(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_evidence jsonb;
  v_result jsonb;
begin
  select case when jsonb_typeof(evidence) = 'object' then evidence else '{}'::jsonb end
  into v_evidence
  from public.messages
  where id = p_message_id and owner_id = auth.uid() and role = 'assistant';

  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  with node_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'nodes', '[]'::jsonb))
    limit 50
  ), cited_node_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'cited_nodes', '[]'::jsonb))
    limit 20
  ), searched_node_ids as (
    select (item->>'node_id')::uuid id,
           nullif(item->>'retrieval_score', '')::numeric retrieval_score,
           case when jsonb_typeof(item->'retrieval_evidence') = 'array'
             then item->'retrieval_evidence' else '[]'::jsonb end retrieval_evidence
    from jsonb_array_elements(coalesce(v_evidence->'searched_nodes', '[]'::jsonb)) item
    where nullif(item->>'node_id', '') is not null
    limit 50
  ), content_versions as (
    select (item->>'node_id')::uuid id, nullif(item->>'content_version', '')::bigint cited_version
    from jsonb_array_elements(coalesce(v_evidence->'content', '[]'::jsonb)) item
  ), summary_versions as (
    select (item->>'conversation_id')::uuid id, nullif(item->>'summary_version', '')::bigint cited_version
    from jsonb_array_elements(coalesce(v_evidence->'conversation_summaries', '[]'::jsonb)) item
  ), edge_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'edges', '[]'::jsonb))
    limit 100
  ), assertion_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'assertions', '[]'::jsonb))
    limit 100
  ), message_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'messages', '[]'::jsonb))
    limit 50
  ), searched_message_ids as (
    select value::uuid id
    from jsonb_array_elements_text(coalesce(v_evidence->'searched_messages', '[]'::jsonb))
    limit 50
  )
  select jsonb_build_object(
    'message_id', p_message_id,
    'nodes', coalesce((
      select jsonb_agg(to_jsonb(n) || jsonb_build_object(
        'content_excerpt', case
          when n.type = 'note' then left(coalesce(note.markdown, ''), 4000)
          when n.type = 'memory' then memory.statement
          when n.type = 'conversation' then summary.summary
          else null end,
        'cited_version', coalesce(cv.cited_version, sv.cited_version),
        'current_content_version', case
          when n.type = 'note' then note.content_version
          when n.type = 'conversation' then summary.summary_version
          else null end,
        'changed_since_answer', case
          when cv.cited_version is not null then note.content_version is distinct from cv.cited_version
          when sv.cited_version is not null then summary.summary_version is distinct from sv.cited_version
          else false end
      ) order by n.title)
      from node_ids requested
      join public.nodes n on n.id = requested.id and n.owner_id = auth.uid()
      left join public.notes note on note.node_id = n.id
      left join public.memories memory on memory.node_id = n.id
      left join public.conversation_summaries summary on summary.conversation_id = n.id
      left join content_versions cv on cv.id = n.id
      left join summary_versions sv on sv.id = n.id
    ), '[]'::jsonb),
    'cited_nodes', coalesce((
      select jsonb_agg(cited.id order by cited.id)
      from cited_node_ids cited
      join node_ids used on used.id = cited.id
      join public.nodes n on n.id = cited.id and n.owner_id = auth.uid()
    ), '[]'::jsonb),
    'searched_nodes', coalesce((
      select jsonb_agg(to_jsonb(n) || jsonb_build_object(
        'retrieval_score', requested.retrieval_score,
        'retrieval_evidence', requested.retrieval_evidence
      ) order by requested.retrieval_score desc nulls last, n.title)
      from searched_node_ids requested
      join public.nodes n on n.id = requested.id and n.owner_id = auth.uid()
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(e) || jsonb_build_object(
        'source', jsonb_build_object('id', source.id, 'title', source.title, 'type', source.type),
        'target', jsonb_build_object('id', target.id, 'title', target.title, 'type', target.type),
        'assertions', coalesce((
          select jsonb_agg(to_jsonb(a) order by a.created_at)
          from public.edge_assertions a
          where a.owner_id = auth.uid() and a.edge_id = e.id
            and (a.id in (select id from assertion_ids)
              or (a.status = 'active' and a.retracted_at is null))
        ), '[]'::jsonb)
      ) order by e.created_at)
      from edge_ids requested
      join public.edges e on e.id = requested.id and e.owner_id = auth.uid()
      join public.nodes source on source.id = e.source_node_id
      join public.nodes target on target.id = e.target_node_id
    ), '[]'::jsonb),
    'assertions', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at)
      from assertion_ids requested
      join public.edge_assertions a on a.id = requested.id and a.owner_id = auth.uid()
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id, 'conversation_id', message.conversation_id,
        'conversation_title', conversation.title, 'role', message.role,
        'content', left(message.content, 4000), 'created_at', message.created_at,
        'sequence', message.sequence
      ) order by message.created_at)
      from message_ids requested
      join public.messages message on message.id = requested.id and message.owner_id = auth.uid()
      join public.nodes conversation on conversation.id = message.conversation_id
    ), '[]'::jsonb),
    'searched_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id, 'conversation_id', message.conversation_id,
        'conversation_title', conversation.title, 'role', message.role,
        'content', left(message.content, 4000), 'created_at', message.created_at,
        'sequence', message.sequence
      ) order by message.created_at)
      from searched_message_ids requested
      join public.messages message on message.id = requested.id and message.owner_id = auth.uid()
      join public.nodes conversation on conversation.id = message.conversation_id
    ), '[]'::jsonb),
    'conversation_summaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', summary.conversation_id, 'title', conversation.title,
        'summary', summary.summary, 'summary_version', summary.summary_version,
        'cited_version', requested.cited_version,
        'changed_since_answer', summary.summary_version is distinct from requested.cited_version,
        'updated_at', summary.updated_at
      ) order by conversation.title)
      from summary_versions requested
      join public.conversation_summaries summary on summary.conversation_id = requested.id
      join public.nodes conversation on conversation.id = summary.conversation_id and conversation.owner_id = auth.uid()
    ), '[]'::jsonb),
    'paths', coalesce(v_evidence->'paths', '[]'::jsonb),
    'missing', jsonb_build_object(
      'nodes', coalesce((select jsonb_agg(id) from node_ids where not exists (
        select 1 from public.nodes n where n.id = node_ids.id and n.owner_id = auth.uid()
      )), '[]'::jsonb),
      'searched_nodes', coalesce((select jsonb_agg(id) from searched_node_ids where not exists (
        select 1 from public.nodes n where n.id = searched_node_ids.id and n.owner_id = auth.uid()
      )), '[]'::jsonb),
      'edges', coalesce((select jsonb_agg(id) from edge_ids where not exists (
        select 1 from public.edges e where e.id = edge_ids.id and e.owner_id = auth.uid()
      )), '[]'::jsonb),
      'assertions', coalesce((select jsonb_agg(id) from assertion_ids where not exists (
        select 1 from public.edge_assertions a where a.id = assertion_ids.id and a.owner_id = auth.uid()
      )), '[]'::jsonb),
      'messages', coalesce((select jsonb_agg(id) from message_ids where not exists (
        select 1 from public.messages m where m.id = message_ids.id and m.owner_id = auth.uid()
      )), '[]'::jsonb),
      'searched_messages', coalesce((select jsonb_agg(id) from searched_message_ids where not exists (
        select 1 from public.messages m where m.id = searched_message_ids.id and m.owner_id = auth.uid()
      )), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_message_evidence(uuid) from public, anon;
grant execute on function public.get_message_evidence(uuid) to authenticated;

comment on function public.get_message_evidence(uuid) is
  'Resolves owner-scoped cited/used evidence separately from inspected search candidates for one assistant response.';

commit;
