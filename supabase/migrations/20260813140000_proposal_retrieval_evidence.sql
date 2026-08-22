-- Close the remaining V1 gaps around exact relationship proposals, retrieval,
-- evidence attribution, and relationship vocabulary metadata.

alter table public.ai_runs
  add column if not exists request_message_id uuid references public.messages(id) on delete set null,
  add column if not exists tool_call_count integer not null default 0,
  add column if not exists tool_cache_hit_count integer not null default 0;

alter table public.relationship_types
  add column if not exists is_hierarchical boolean not null default false,
  add column if not exists must_be_acyclic boolean not null default false,
  add column if not exists allows_self_reference boolean not null default false;

update public.relationship_types
set is_hierarchical = true,
    must_be_acyclic = true
where name = 'part_of';

create table if not exists public.relationship_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  source_message_id uuid references public.messages(id) on delete set null,
  source_node_id uuid not null references public.nodes(id) on delete cascade,
  target_node_id uuid not null references public.nodes(id) on delete cascade,
  relationship_type text not null references public.relationship_types(name),
  semantic_key text not null,
  reason text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  edge_id uuid references public.edges(id) on delete set null,
  assertion_id uuid references public.edge_assertions(id) on delete set null,
  superseded_by_proposal_id uuid references public.relationship_proposals(id) on delete set null,
  edge_was_created boolean,
  assertion_was_created boolean,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (ai_run_id, semantic_key)
);

create index if not exists relationship_proposals_owner_created_idx
  on public.relationship_proposals(owner_id, created_at desc);
create index if not exists relationship_proposals_semantic_status_idx
  on public.relationship_proposals(owner_id, semantic_key, status);
create index if not exists relationship_proposals_conversation_audit_idx
  on public.relationship_proposals(ai_run_id, created_at desc);

alter table public.relationship_proposals enable row level security;

drop policy if exists relationship_proposals_select_own on public.relationship_proposals;
create policy relationship_proposals_select_own
on public.relationship_proposals for select
using (owner_id = auth.uid());

alter table public.graph_changes
  add column if not exists proposal_id uuid references public.relationship_proposals(id) on delete set null,
  add column if not exists edge_id uuid references public.edges(id) on delete set null,
  add column if not exists confidence numeric
    check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table public.graph_changes drop constraint if exists graph_changes_operation_check;
alter table public.graph_changes
  add constraint graph_changes_operation_check
  check (operation in (
    'create_node', 'update_node', 'archive_node', 'restore_node',
    'create_assertion', 'retract_assertion', 'update_note',
    'request_relationship'
  ));

alter table public.graph_changes drop constraint if exists graph_changes_approval_state_check;
alter table public.graph_changes
  add constraint graph_changes_approval_state_check
  check (approval_state in ('proposed', 'applied', 'rejected', 'superseded', 'undone'));

-- Existing duplicate AI support represents repeated intent, not independent
-- evidence. Preserve the history while retracting all but the oldest support.
with ranked as (
  select id,
         row_number() over (partition by edge_id order by created_at, id) as position
  from public.edge_assertions
  where provenance = 'ai'
    and status = 'active'
    and retracted_at is null
)
update public.edge_assertions a
set status = 'retracted',
    retracted_at = now(),
    updated_at = now()
from ranked r
where a.id = r.id
  and r.position > 1;

create unique index if not exists edge_assertions_one_active_ai_support_idx
  on public.edge_assertions(edge_id)
  where provenance = 'ai' and status = 'active' and retracted_at is null;

create index if not exists notes_markdown_search_idx
  on public.notes using gin (to_tsvector('simple', markdown));

create index if not exists node_content_chunks_embedding_hnsw_idx
  on public.node_content_chunks using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.canonical_relationship_identity(
  p_owner_id uuid,
  p_source_node_id uuid,
  p_target_node_id uuid,
  p_relationship_type text
)
returns table(source_node_id uuid, target_node_id uuid, semantic_key text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_symmetric boolean;
  v_source uuid := p_source_node_id;
  v_target uuid := p_target_node_id;
begin
  select is_symmetric into v_symmetric
  from public.relationship_types
  where name = p_relationship_type;

  if not found then
    raise exception 'unknown_relationship_type';
  end if;

  if not exists (
    select 1 from public.nodes
    where id = p_source_node_id and owner_id = p_owner_id and archived_at is null
  ) or not exists (
    select 1 from public.nodes
    where id = p_target_node_id and owner_id = p_owner_id and archived_at is null
  ) then
    raise exception 'node_not_found';
  end if;

  if p_source_node_id = p_target_node_id then
    raise exception 'self_relationship_not_allowed';
  end if;

  if v_symmetric and v_source::text > v_target::text then
    v_source := p_target_node_id;
    v_target := p_source_node_id;
  end if;

  return query
  select v_source,
         v_target,
         concat_ws(':', p_owner_id::text, v_source::text, p_relationship_type, v_target::text);
end;
$$;

create or replace function public.propose_relationship(
  p_source_node_id uuid,
  p_target_node_id uuid,
  p_relationship_type text,
  p_reason text,
  p_confidence numeric,
  p_ai_run_id uuid,
  p_source_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_source uuid;
  v_target uuid;
  v_key text;
  v_proposal public.relationship_proposals%rowtype;
  v_edge public.edges%rowtype;
  v_assertion public.edge_assertions%rowtype;
  v_existing boolean := false;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.ai_runs
    where id = p_ai_run_id
      and owner_id = v_user
      and (request_message_id = p_source_message_id or request_message_id is null)
  ) then
    raise exception 'ai_run_not_found';
  end if;

  if p_source_message_id is not null and not exists (
    select 1 from public.messages where id = p_source_message_id and owner_id = v_user
  ) then
    raise exception 'source_message_not_found';
  end if;

  select source_node_id, target_node_id, semantic_key
  into v_source, v_target, v_key
  from public.canonical_relationship_identity(
    v_user, p_source_node_id, p_target_node_id, p_relationship_type
  );

  select * into v_proposal
  from public.relationship_proposals
  where ai_run_id = p_ai_run_id and semantic_key = v_key;

  if found then
    return jsonb_build_object(
      'proposal', to_jsonb(v_proposal),
      'status', case when v_proposal.status = 'approved' then 'already_exists' else v_proposal.status end,
      'edge_created', coalesce(v_proposal.edge_was_created, false),
      'assertion_created', coalesce(v_proposal.assertion_was_created, false)
    );
  end if;

  select * into v_edge
  from public.edges
  where owner_id = v_user
    and source_node_id = v_source
    and target_node_id = v_target
    and relationship_type = p_relationship_type
    and archived_at is null;

  if found then
    select * into v_assertion
    from public.edge_assertions
    where edge_id = v_edge.id
      and owner_id = v_user
      and provenance = 'ai'
      and status = 'active'
      and retracted_at is null
    order by created_at
    limit 1;
    v_existing := found;
  end if;

  insert into public.relationship_proposals (
    owner_id, ai_run_id, source_message_id, source_node_id, target_node_id,
    relationship_type, semantic_key, reason, confidence, status,
    edge_id, assertion_id, edge_was_created, assertion_was_created, resolved_at
  ) values (
    v_user, p_ai_run_id, p_source_message_id, v_source, v_target,
    p_relationship_type, v_key, p_reason, p_confidence,
    case when v_existing then 'approved' else 'pending' end,
    case when v_existing then v_edge.id else null end,
    case when v_existing then v_assertion.id else null end,
    case when v_existing then false else null end,
    case when v_existing then false else null end,
    case when v_existing then now() else null end
  ) returning * into v_proposal;

  insert into public.graph_changes (
    owner_id, ai_run_id, proposal_id, node_id, edge_id, assertion_id,
    operation, actor, approval_state, reason, confidence, after_snapshot
  ) values (
    v_user, p_ai_run_id, v_proposal.id, v_source,
    case when v_existing then v_edge.id else null end,
    case when v_existing then v_assertion.id else null end,
    'request_relationship', 'ai',
    case when v_existing then 'applied' else 'proposed' end,
    p_reason, p_confidence,
    jsonb_build_object(
      'proposal_id', v_proposal.id,
      'semantic_key', v_key,
      'result', case when v_existing then 'reused_existing_relationship' else 'pending_approval' end
    )
  );

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'status', case when v_existing then 'already_exists' else 'pending' end,
    'edge_created', false,
    'assertion_created', false
  );
end;
$$;

create or replace function public.resolve_relationship_proposal(
  p_proposal_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_proposal public.relationship_proposals%rowtype;
  v_edge public.edges%rowtype;
  v_assertion public.edge_assertions%rowtype;
  v_edge_created boolean := false;
  v_assertion_created boolean := false;
  v_superseded integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_proposal
  from public.relationship_proposals
  where id = p_proposal_id and owner_id = v_user;

  if not found then
    raise exception 'proposal_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_proposal.semantic_key, 0));

  select * into v_proposal
  from public.relationship_proposals
  where id = p_proposal_id and owner_id = v_user
  for update;

  if v_proposal.status <> 'pending' then
    raise exception 'proposal_not_pending:%', v_proposal.status;
  end if;

  if not p_approve then
    update public.relationship_proposals
    set status = 'rejected', resolved_at = now()
    where id = v_proposal.id
    returning * into v_proposal;

    update public.graph_changes
    set approval_state = 'rejected'
    where proposal_id = v_proposal.id;

    return jsonb_build_object('proposal', to_jsonb(v_proposal), 'status', 'rejected');
  end if;

  select * into v_edge
  from public.edges
  where owner_id = v_user
    and source_node_id = v_proposal.source_node_id
    and target_node_id = v_proposal.target_node_id
    and relationship_type = v_proposal.relationship_type
    and archived_at is null
  for update;

  if not found then
    select * into v_edge
    from public.ensure_semantic_edge(
      v_proposal.source_node_id,
      v_proposal.target_node_id,
      v_proposal.relationship_type
    );
    v_edge_created := true;
  end if;

  select * into v_assertion
  from public.edge_assertions
  where edge_id = v_edge.id
    and owner_id = v_user
    and provenance = 'ai'
    and status = 'active'
    and retracted_at is null
  order by created_at
  limit 1
  for update;

  if not found then
    insert into public.edge_assertions (
      owner_id, edge_id, provenance, status, reason, confidence,
      source_message_id, source_ai_run_id, actor_id, origin_key
    ) values (
      v_user, v_edge.id, 'ai', 'active', v_proposal.reason, v_proposal.confidence,
      v_proposal.source_message_id, v_proposal.ai_run_id, v_user,
      'ai-semantic:' || v_proposal.semantic_key
    ) returning * into v_assertion;
    v_assertion_created := true;
  end if;

  update public.relationship_proposals
  set status = 'approved',
      edge_id = v_edge.id,
      assertion_id = v_assertion.id,
      edge_was_created = v_edge_created,
      assertion_was_created = v_assertion_created,
      resolved_at = now()
  where id = v_proposal.id
  returning * into v_proposal;

  update public.graph_changes
  set approval_state = 'applied',
      edge_id = v_edge.id,
      assertion_id = v_assertion.id,
      after_snapshot = coalesce(after_snapshot, '{}'::jsonb) || jsonb_build_object(
        'result', case when v_assertion_created then 'created_ai_support' else 'reused_ai_support' end,
        'edge_created', v_edge_created,
        'assertion_created', v_assertion_created
      )
  where proposal_id = v_proposal.id;

  with superseded as (
    update public.relationship_proposals
    set status = 'superseded',
        superseded_by_proposal_id = v_proposal.id,
        edge_id = v_edge.id,
        assertion_id = v_assertion.id,
        edge_was_created = false,
        assertion_was_created = false,
        resolved_at = now()
    where owner_id = v_user
      and semantic_key = v_proposal.semantic_key
      and status = 'pending'
      and id <> v_proposal.id
    returning id
  )
  select count(*)::integer into v_superseded from superseded;

  update public.graph_changes gc
  set approval_state = 'superseded',
      edge_id = v_edge.id,
      assertion_id = v_assertion.id,
      after_snapshot = coalesce(gc.after_snapshot, '{}'::jsonb) || jsonb_build_object(
        'result', 'superseded',
        'superseded_by_proposal_id', v_proposal.id
      )
  from public.relationship_proposals rp
  where gc.proposal_id = rp.id
    and rp.superseded_by_proposal_id = v_proposal.id;

  return jsonb_build_object(
    'proposal', to_jsonb(v_proposal),
    'status', 'approved',
    'edge', to_jsonb(v_edge),
    'assertion', to_jsonb(v_assertion),
    'edge_created', v_edge_created,
    'assertion_created', v_assertion_created,
    'superseded_count', v_superseded
  );
end;
$$;

create or replace function public.search_graph(
  p_query text default '',
  p_types text[] default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with query_parts as (
    select trim(coalesce(p_query, '')) as query_text,
           case when trim(coalesce(p_query, '')) = '' then null
                else plainto_tsquery('simple', trim(p_query)) end as ts_query
  ),
  candidates as (
    select n.id, n.owner_id, n.type, n.title, n.summary, n.version,
           n.created_at, n.updated_at, n.archived_at,
           left(coalesce(no.markdown, ''), 700) as content_excerpt,
           greatest(
             case when lower(n.title) = lower(q.query_text) then 12.0 else 0.0 end,
             case when n.title ilike '%' || q.query_text || '%' then 8.0 else 0.0 end,
             case when exists (
               select 1 from public.node_aliases a
               where a.node_id = n.id and a.owner_id = auth.uid()
                 and a.alias ilike '%' || q.query_text || '%'
             ) then 7.0 else 0.0 end,
             case when n.summary ilike '%' || q.query_text || '%' then 5.0 else 0.0 end,
             case when q.ts_query is not null
               then ts_rank_cd(to_tsvector('simple', coalesce(no.markdown, '')), q.ts_query) * 4.0
               else 0.0 end
           ) as rank,
           case
             when lower(n.title) = lower(q.query_text) then 'exact_title'
             when n.title ilike '%' || q.query_text || '%' then 'title'
             when exists (
               select 1 from public.node_aliases a
               where a.node_id = n.id and a.owner_id = auth.uid()
                 and a.alias ilike '%' || q.query_text || '%'
             ) then 'alias'
             when n.summary ilike '%' || q.query_text || '%' then 'summary'
             else 'note_content'
           end as match_reason
    from public.nodes n
    left join public.notes no on no.node_id = n.id
    cross join query_parts q
    where n.owner_id = auth.uid()
      and n.archived_at is null
      and (p_types is not null or n.type <> 'conversation')
      and (p_types is null or n.type = any(p_types))
      and (
        q.query_text = ''
        or n.title ilike '%' || q.query_text || '%'
        or coalesce(n.summary, '') ilike '%' || q.query_text || '%'
        or exists (
          select 1 from public.node_aliases a
          where a.node_id = n.id and a.owner_id = auth.uid()
            and a.alias ilike '%' || q.query_text || '%'
        )
        or (q.ts_query is not null and to_tsvector('simple', coalesce(no.markdown, '')) @@ q.ts_query)
      )
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.rank desc, c.updated_at desc), '[]'::jsonb)
  from (select * from candidates order by rank desc, updated_at desc limit least(p_limit, 50)) c;
$$;

create or replace function public.match_node_embeddings(
  p_embedding extensions.vector(1536),
  p_types text[] default null,
  p_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(result order by (result->>'similarity')::numeric desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', n.id,
      'type', n.type,
      'title', n.title,
      'summary', n.summary,
      'version', n.version,
      'updated_at', n.updated_at,
      'match_reason', 'semantic_similarity',
      'similarity', 1 - (c.embedding <=> p_embedding)
    ) as result
    from public.node_content_chunks c
    join public.nodes n on n.id = c.node_id
    where c.owner_id = auth.uid()
      and n.owner_id = auth.uid()
      and n.archived_at is null
      and c.embedding is not null
      and (p_types is not null or n.type <> 'conversation')
      and (p_types is null or n.type = any(p_types))
    order by c.embedding <=> p_embedding
    limit least(p_limit, 30)
  ) ranked;
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
             'resolved_at', rp.resolved_at
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

revoke all on function public.canonical_relationship_identity(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.propose_relationship(uuid, uuid, text, text, numeric, uuid, uuid) from public, anon;
revoke all on function public.resolve_relationship_proposal(uuid, boolean) from public, anon;
revoke all on function public.search_graph(text, text[], integer) from public, anon;
revoke all on function public.match_node_embeddings(extensions.vector, text[], integer) from public, anon;
revoke all on function public.get_activity_feed(integer) from public, anon;

grant execute on function public.propose_relationship(uuid, uuid, text, text, numeric, uuid, uuid) to authenticated;
grant execute on function public.resolve_relationship_proposal(uuid, boolean) to authenticated;
grant execute on function public.search_graph(text, text[], integer) to authenticated;
grant execute on function public.match_node_embeddings(extensions.vector, text[], integer) to authenticated;
grant execute on function public.get_activity_feed(integer) to authenticated;

comment on table public.relationship_proposals is
  'Auditable AI relationship intents. Exact semantic equivalents reconcile to one edge and one active AI assertion.';
comment on column public.relationship_proposals.semantic_key is
  'Canonical owner + normalized source + relationship type + normalized target identity.';
comment on function public.resolve_relationship_proposal(uuid, boolean) is
  'Serializes approval by semantic key, reuses canonical graph facts, and supersedes stale equivalent proposals.';
