begin;

create extension if not exists pgtap with schema extensions;
select plan(77);

select has_table('public', 'nodes', 'nodes table exists');
select has_table('public', 'edges', 'edges table exists');
select has_table('public', 'edge_assertions', 'edge assertions table exists');
select has_table('public', 'conversations', 'conversations table exists');
select has_table('public', 'messages', 'messages table exists');
select has_table('public', 'graph_changes', 'activity ledger exists');
select has_function('public', 'create_entity', array['text', 'text', 'text', 'text', 'text', 'uuid', 'text'], 'typed entity mutation exists');
select ok(
  not exists(select 1 from public.nodes where type in ('project', 'topic', 'person')),
  'removed placeholder node types are migrated without leaving legacy rows'
);
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid = 'public.nodes'::regclass
      and conname = 'nodes_type_check'
      and pg_get_constraintdef(oid) not like '%project%'
      and pg_get_constraintdef(oid) not like '%topic%'
      and pg_get_constraintdef(oid) not like '%person%'
  ),
  'node type constraint removes placeholder domain types'
);
select ok(
  exists(
    select 1 from pg_constraint
    where conrelid = 'public.nodes'::regclass
      and conname = 'nodes_type_check'
      and pg_get_constraintdef(oid) like '%memory%'
  ),
  'node type constraint includes approved Memories'
);
select is(
  (select allowed_target_types from public.relationship_types where name = 'produced'),
  array['note', 'memory']::text[],
  'conversation production targets notes and approved Memories'
);
select has_table('public', 'memories', 'typed Memory extension exists');
select has_table('public', 'memory_revisions', 'Memory revision history exists');
select has_table('public', 'memory_revision_sources', 'Memory revisions have normalized message provenance');
select has_table('public', 'memory_proposals', 'Memory approval lifecycle exists');
select has_table('public', 'memory_proposal_connections', 'Memory proposal bundles include editable connections');
select has_function('public', 'propose_memory', array['text', 'text', 'text', 'text', 'numeric', 'timestamp with time zone', 'uuid', 'uuid[]', 'jsonb'], 'AI Memory extraction has a typed proposal RPC');
select has_function('public', 'update_memory_proposal', array['uuid', 'text', 'text', 'text', 'numeric', 'timestamp with time zone', 'jsonb'], 'pending Memory bundles are editable');
select has_function('public', 'resolve_memory_proposal', array['uuid', 'boolean'], 'Memory approval is transactional');
select has_function('public', 'undo_memory_proposal', array['uuid'], 'approved Memory changes can be undone');
select has_function('public', 'search_memory_context', array['text', 'integer'], 'bounded approved Memory retrieval exists');
select has_function('public', 'resolve_explicit_node_mentions', array['text', 'integer'], 'Memory extraction resolves exact node-title and alias mentions independently');
select has_extension('pg_trgm', 'typo-tolerant title and alias matching is available');
select has_function('public', 'reset_workspace_data', array['text'], 'authenticated users can transactionally reset their own test workspace');
select has_trigger('public', 'memory_proposal_connections', 'memory_proposal_connections_normalize_about_direction', 'Memory about connections are normalized to Memory → node');
select has_function('public', 'create_note', array['text', 'text', 'text', 'jsonb', 'text', 'uuid', 'text'], 'initial note creation transactionally reconciles wiki-links');
select has_function('public', 'delete_entity_permanently', array['uuid', 'text'], 'test entities can be permanently deleted with exact-title confirmation');
select ok(
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'memories' and policyname = 'own_memories_read'),
  'Memories use owner-scoped RLS'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'memories_validate_node' and not tgisinternal),
  'Memory extensions require Memory nodes with the same owner'
);
select has_function('public', 'get_neighborhood', array['uuid', 'text[]', 'text', 'integer'], 'bounded neighborhood RPC exists');
select has_function('public', 'traverse_graph', array['uuid[]', 'integer', 'text[]', 'text', 'integer', 'integer'], 'bounded traversal RPC exists');
select has_function('public', 'undo_graph_change', array['uuid'], 'undo RPC exists');

select is(
  (select count(*)::integer from public.relationship_types),
  8,
  'the V1 relationship vocabulary is seeded'
);

select ok(
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'nodes' and policyname = 'own_nodes_read'),
  'nodes use owner-scoped RLS'
);
select ok(
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'edge_assertions' and policyname = 'own_assertions_read'),
  'assertions use owner-scoped RLS'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'edges_live_semantic_unique'),
  'live semantic edges have a canonical uniqueness index'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'edges_prevent_part_of_cycle' and not tgisinternal),
  'part_of cycle prevention is installed'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'edge_assertions_refresh_edge' and not tgisinternal),
  'assertion lifecycle controls edge archival'
);

select has_table('public', 'relationship_proposals', 'relationship proposal audit table exists');
select has_function('public', 'propose_relationship', array['uuid', 'uuid', 'text', 'text', 'numeric', 'uuid', 'uuid'], 'exact relationship proposal RPC exists');
select has_function('public', 'resolve_relationship_proposal', array['uuid', 'boolean'], 'serialized proposal resolver exists');
select has_function('public', 'search_graph', array['text', 'text[]', 'integer'], 'ranked lexical graph search exists');
select has_function('public', 'get_activity_feed', array['integer'], 'unified audit feed exists');
select has_column('public', 'messages', 'ai_run_id', 'assistant responses link to their authoritative AI run');
select has_function('public', 'get_activity_page', array['integer', 'timestamp with time zone', 'uuid', 'text', 'uuid'], 'cursor-paginated activity reader exists');
select has_function('public', 'get_message_evidence', array['uuid'], 'bounded response evidence reader exists');
select ok(
  pg_get_functiondef('public.get_message_evidence(uuid)'::regprocedure) like '%searched_nodes%'
    and pg_get_functiondef('public.get_message_evidence(uuid)'::regprocedure) like '%cited_nodes%',
  'response evidence distinguishes cited sources from search candidates'
);
select ok(
  exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'edge_assertions_one_active_ai_support_idx'),
  'an edge permits only one active AI assertion'
);
select ok(
  exists(select 1 from pg_constraint where conrelid = 'public.relationship_proposals'::regclass and pg_get_constraintdef(oid) like '%superseded%'),
  'proposal lifecycle includes the superseded state'
);
select is(
  (select must_be_acyclic from public.relationship_types where name = 'part_of'),
  true,
  'part_of declares its acyclic invariant in the relationship catalog'
);
select has_column('public', 'ai_runs', 'request_message_id', 'AI runs attribute requests to exact messages');
select has_column('public', 'graph_changes', 'proposal_id', 'graph change audit entries link to proposals');
select has_function('public', 'undo_relationship_proposal', array['uuid'], 'approved proposal undo RPC exists');
select has_column('public', 'relationship_proposals', 'undone_at', 'proposal audit preserves undo timing');
select ok(exists(select 1 from public.relationship_types where name = 'discusses'), 'conversation discusses relationship is registered');
select ok(exists(select 1 from public.relationship_types where name = 'produced'), 'conversation produced relationship is registered');
select ok(
  exists(select 1 from pg_trigger where tgname = 'relationship_proposals_context_after_approval' and not tgisinternal),
  'approved relationship proposals restore deterministic Note discussion context'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'graph_changes_ai_created_node_context' and not tgisinternal),
  'AI-created nodes receive produced conversation context edges'
);
select has_function('public', 'ensure_ai_note_update_discussion', array['uuid'], 'AI Note updates have a narrowly validated discussion reconciler');
select ok(
  exists(select 1 from pg_trigger where tgname = 'graph_changes_ai_note_update_context' and not tgisinternal),
  'AI-authored updates to existing Notes receive deterministic discussion context'
);
select has_table('public', 'conversation_summaries', 'durable conversation summaries exist');
select has_column('public', 'messages', 'sequence', 'messages have dependable ordered cursors');
select has_function('public', 'search_conversation_messages', array['uuid', 'text', 'integer'], 'bounded conversation message search exists');
select has_function('public', 'get_message_context', array['uuid', 'integer', 'integer'], 'bounded message context retrieval exists');
select has_function('public', 'get_conversation_summary', array['uuid'], 'conversation summary retrieval exists');
select has_function('public', 'save_conversation_summary', array['uuid', 'bigint', 'text', 'text[]', 'jsonb', 'jsonb', 'jsonb', 'uuid', 'bigint', 'timestamp with time zone', 'text', 'text'], 'serialized summary commit RPC exists');
select has_function('public', 'ensure_conversation_context_edge', array['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'jsonb', 'text'], 'deterministic conversation production reconciliation exists');
select has_function('public', 'record_conversation_context', array['uuid', 'uuid', 'text', 'uuid'], 'explicit Note mentions can restore conversation discussion context');
select has_function('public', 'create_ai_entity_resolving_identity', array['text', 'text', 'text', 'text', 'uuid', 'text'], 'deployed AI creation remains compatible with global title numbering');
select ok(
  exists(select 1 from pg_trigger where tgname = 'nodes_assign_unique_title' and not tgisinternal),
  'all node creation and renames receive atomic owner-wide title numbering'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'edge_assertions_subsume_automated_related_to' and not tgisinternal),
  'precise relationships subsume only automated related_to support'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'nodes_bound_conversation_summary_projection' and not tgisinternal),
  'conversation node summaries remain bounded search projections'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'messages_touch_conversation' and not tgisinternal),
  'conversation node modified time follows message activity'
);
select ok(
  exists(select 1 from pg_trigger where tgname = 'notes_touch_parent_node' and not tgisinternal),
  'note node modified time follows Markdown edits'
);

insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000901', 'workspace-search-test@example.com');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000901', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.nodes (owner_id, type, title, summary, updated_at) values
  ('00000000-0000-4000-8000-000000000901', 'conversation', 'Alpha', null, '2026-08-22T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000901', 'note', 'Alpha planning', null, '2026-08-22T11:00:00Z'),
  ('00000000-0000-4000-8000-000000000901', 'memory', 'Alpha retrospective', null, '2026-08-22T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000901', 'conversation', 'Project Alpha', null, '2026-08-22T13:00:00Z'),
  ('00000000-0000-4000-8000-000000000901', 'note', 'Hidden summary result', 'Alpha only appears in the summary', '2026-08-22T14:00:00Z'),
  ('00000000-0000-4000-8000-000000000901', 'note', 'Recent unrelated title', null, '2026-08-22T15:00:00Z');

insert into public.node_aliases (owner_id, node_id, alias)
select owner_id, id, 'Alpha alias only'
from public.nodes
where owner_id = '00000000-0000-4000-8000-000000000901'
  and title = 'Recent unrelated title';

select results_eq(
  $$select title from public.search_nodes('alpha', null, 25)$$,
  $$values ('Alpha'::text), ('Alpha retrospective'::text), ('Alpha planning'::text), ('Project Alpha'::text)$$,
  'workspace search matches titles only and ranks exact, prefix, then contains'
);

select results_eq(
  $$select title from public.search_nodes('', null, 2)$$,
  $$values ('Recent unrelated title'::text), ('Hidden summary result'::text)$$,
  'empty workspace search returns the most recently updated nodes'
);

select results_eq(
  $$select title from public.search_nodes('alpha', array['conversation'], 25)$$,
  $$values ('Alpha'::text), ('Project Alpha'::text)$$,
  'workspace search applies the selected node type'
);

select * from finish();
rollback;
