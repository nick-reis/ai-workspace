-- Durable response-to-run links plus bounded, owner-scoped activity and
-- evidence readers for the rebuilt History and Chat review surfaces.

alter table public.messages
  add column if not exists ai_run_id uuid references public.ai_runs(id) on delete set null;

create unique index if not exists messages_ai_run_unique
  on public.messages(ai_run_id)
  where ai_run_id is not null;

create index if not exists messages_conversation_ai_run_idx
  on public.messages(owner_id, conversation_id, ai_run_id)
  where ai_run_id is not null;

-- Older responses predate the explicit link. Only pair a run with the first
-- assistant response after its request when no later user turn intervenes.
with response_matches as (
  select ar.id as ai_run_id,
         (
           select response.id
           from public.messages response
           join public.messages request on request.id = ar.request_message_id
           where response.owner_id = ar.owner_id
             and response.conversation_id = ar.conversation_id
             and response.role = 'assistant'
             and response.sequence > request.sequence
             and not exists (
               select 1 from public.messages intervening
               where intervening.owner_id = ar.owner_id
                 and intervening.conversation_id = ar.conversation_id
                 and intervening.role = 'user'
                 and intervening.sequence > request.sequence
                 and intervening.sequence < response.sequence
             )
           order by response.sequence
           limit 1
         ) as message_id
  from public.ai_runs ar
  where ar.request_message_id is not null
), unique_matches as (
  select (array_agg(ai_run_id))[1] as ai_run_id, message_id
  from response_matches
  where message_id is not null
  group by message_id
  having count(*) = 1
)
update public.messages message
set ai_run_id = match.ai_run_id
from unique_matches match
where message.id = match.message_id
  and message.ai_run_id is null;

create or replace function public.get_activity_page(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_state text default null,
  p_ai_run_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with relationship_items as (
    select rp.id, rp.created_at, rp.ai_run_id,
      case when rp.undone_at is not null then 'undone'
           when rp.status = 'approved' then 'applied'
           else rp.status end as state,
      jsonb_build_object(
        'kind', 'relationship_proposal', 'id', rp.id, 'status', rp.status,
        'state', case when rp.undone_at is not null then 'undone'
                      when rp.status = 'approved' then 'applied'
                      else rp.status end,
        'available_actions', case
          when rp.status = 'pending' then jsonb_build_array('approve', 'reject')
          when rp.status = 'approved' and rp.undone_at is null
            and coalesce(rp.assertion_was_created, false)
            then jsonb_build_array('undo')
          else '[]'::jsonb end,
        'source_node_id', rp.source_node_id, 'source_title', sn.title,
        'target_node_id', rp.target_node_id, 'target_title', tn.title,
        'relationship_type', rp.relationship_type, 'reason', rp.reason,
        'confidence', rp.confidence, 'ai_run_id', rp.ai_run_id,
        'conversation_id', ar.conversation_id, 'edge_id', rp.edge_id,
        'assertion_id', rp.assertion_id,
        'superseded_by_proposal_id', rp.superseded_by_proposal_id,
        'edge_was_created', rp.edge_was_created,
        'assertion_was_created', rp.assertion_was_created,
        'created_at', rp.created_at, 'resolved_at', rp.resolved_at,
        'undone_at', rp.undone_at
      ) as item
    from public.relationship_proposals rp
    join public.nodes sn on sn.id = rp.source_node_id
    join public.nodes tn on tn.id = rp.target_node_id
    join public.ai_runs ar on ar.id = rp.ai_run_id
    where rp.owner_id = auth.uid()
  ), memory_items as (
    select mp.id, mp.created_at, mp.ai_run_id,
      case when mp.undone_at is not null then 'undone'
           when mp.status = 'approved' then 'applied'
           else mp.status end as state,
      public.get_memory_proposal(mp.id) || jsonb_build_object(
        'state', case when mp.undone_at is not null then 'undone'
                      when mp.status = 'approved' then 'applied'
                      else mp.status end,
        'available_actions', case
          when mp.status = 'pending' then jsonb_build_array('approve', 'reject')
          when mp.status = 'approved' and mp.undone_at is null then jsonb_build_array('undo')
          else '[]'::jsonb end
      ) as item
    from public.memory_proposals mp
    where mp.owner_id = auth.uid()
  ), change_items as (
    select gc.id, gc.created_at, gc.ai_run_id,
      case when gc.approval_state = 'proposed' then 'pending' else gc.approval_state end as state,
      jsonb_build_object(
        'kind', 'graph_change', 'id', gc.id, 'operation', gc.operation,
        'approval_state', gc.approval_state,
        'state', case when gc.approval_state = 'proposed' then 'pending' else gc.approval_state end,
        'available_actions', case
          when gc.approval_state = 'proposed' then jsonb_build_array('approve', 'reject')
          when gc.approval_state = 'applied' and gc.undone_at is null
            and gc.operation in ('create_node', 'create_assertion')
            then jsonb_build_array('undo')
          else '[]'::jsonb end,
        'actor', gc.actor, 'reason', gc.reason, 'confidence', gc.confidence,
        'before_snapshot', gc.before_snapshot, 'after_snapshot', gc.after_snapshot,
        'idempotency_key', gc.idempotency_key, 'node_id', gc.node_id,
        'edge_id', gc.edge_id, 'assertion_id', gc.assertion_id,
        'ai_run_id', gc.ai_run_id, 'created_at', gc.created_at,
        'undone_at', gc.undone_at
      ) as item
    from public.graph_changes gc
    where gc.owner_id = auth.uid()
      and gc.proposal_id is null
      and gc.memory_proposal_id is null
  ), all_items as (
    select * from relationship_items
    union all select * from memory_items
    union all select * from change_items
  ), eligible as (
    select * from all_items
    where (p_state is null or state = p_state)
      and (p_ai_run_id is null or ai_run_id = p_ai_run_id)
  ), filtered as (
    select * from eligible
    where (
        p_before_created_at is null
        or (created_at, id) < (p_before_created_at, p_before_id)
      )
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50) + 1
  ), visible as (
    select * from filtered
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by created_at desc, id desc) from visible), '[]'::jsonb),
    'total_count', (select count(*) from eligible),
    'next_cursor', case
      when (select count(*) from filtered) > least(greatest(p_limit, 1), 50)
      then (select jsonb_build_object('created_at', created_at, 'id', id)
            from visible order by created_at asc, id asc limit 1)
      else null end
  );
$$;

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
      'edges', coalesce((select jsonb_agg(id) from edge_ids where not exists (
        select 1 from public.edges e where e.id = edge_ids.id and e.owner_id = auth.uid()
      )), '[]'::jsonb),
      'assertions', coalesce((select jsonb_agg(id) from assertion_ids where not exists (
        select 1 from public.edge_assertions a where a.id = assertion_ids.id and a.owner_id = auth.uid()
      )), '[]'::jsonb),
      'messages', coalesce((select jsonb_agg(id) from message_ids where not exists (
        select 1 from public.messages m where m.id = message_ids.id and m.owner_id = auth.uid()
      )), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_activity_page(integer, timestamptz, uuid, text, uuid) from public, anon;
revoke all on function public.get_message_evidence(uuid) from public, anon;
grant execute on function public.get_activity_page(integer, timestamptz, uuid, text, uuid) to authenticated;
grant execute on function public.get_message_evidence(uuid) to authenticated;

comment on column public.messages.ai_run_id is
  'Authoritative link from an assistant response to the AI run and review proposals it produced.';
comment on function public.get_activity_page(integer, timestamptz, uuid, text, uuid) is
  'Owner-scoped, cursor-paginated auditable activity with authoritative available actions.';
comment on function public.get_message_evidence(uuid) is
  'Resolves only evidence identifiers persisted on one owned assistant response.';
