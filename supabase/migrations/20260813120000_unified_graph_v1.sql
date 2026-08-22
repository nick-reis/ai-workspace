create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table public.relationship_types (
  name text primary key,
  label text not null,
  inverse_label text,
  description text not null,
  is_symmetric boolean not null default false,
  allowed_source_types text[],
  allowed_target_types text[],
  created_at timestamptz not null default now()
);

insert into public.relationship_types
  (name, label, inverse_label, description, is_symmetric)
values
  ('related_to', 'Related to', 'Related to', 'A deliberately broad, symmetric relationship.', true),
  ('references', 'References', 'Referenced by', 'The source explicitly points to the target.', false),
  ('about', 'About', 'Subject of', 'The source is substantially about the target.', false),
  ('part_of', 'Part of', 'Contains', 'The source belongs within the target hierarchy.', false),
  ('supports', 'Supports', 'Supported by', 'The source contributes evidence or work to the target.', false),
  ('derived_from', 'Derived from', 'Source of', 'The source was produced from the target.', false);

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('note', 'project', 'topic', 'person', 'conversation')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  summary text check (summary is null or char_length(summary) <= 2000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index nodes_owner_updated_idx on public.nodes(owner_id, updated_at desc)
  where archived_at is null;
create index nodes_owner_type_idx on public.nodes(owner_id, type)
  where archived_at is null;
create index nodes_search_idx on public.nodes using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))
);

create table public.notes (
  node_id uuid primary key references public.nodes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  markdown text not null default '',
  format_version integer not null default 1,
  content_version bigint not null default 1,
  parsed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  node_id uuid primary key references public.nodes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  model text not null default 'gpt-5.4-mini',
  state text not null default 'active' check (state in ('active', 'complete', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(node_id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  status text not null default 'complete' check (status in ('pending', 'streaming', 'complete', 'error')),
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

create table public.node_aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 240),
  normalized_alias text generated always as (lower(regexp_replace(btrim(alias), '\\s+', ' ', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (owner_id, node_id, normalized_alias)
);

create index node_aliases_lookup_idx on public.node_aliases(owner_id, normalized_alias);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(node_id) on delete set null,
  model text not null,
  request_summary text,
  status text not null default 'running' check (status in ('running', 'complete', 'error', 'cancelled')),
  tool_iterations integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_node_id uuid not null references public.nodes(id) on delete cascade,
  target_node_id uuid not null references public.nodes(id) on delete cascade,
  relationship_type text not null references public.relationship_types(name),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (source_node_id <> target_node_id)
);

create unique index edges_live_semantic_unique
  on public.edges(owner_id, source_node_id, target_node_id, relationship_type)
  where archived_at is null;
create index edges_source_idx on public.edges(owner_id, source_node_id)
  where archived_at is null;
create index edges_target_idx on public.edges(owner_id, target_node_id)
  where archived_at is null;

create table public.edge_assertions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  edge_id uuid not null references public.edges(id) on delete cascade,
  provenance text not null check (provenance in ('user', 'markdown', 'ai', 'system', 'ingestion')),
  actor_id uuid references auth.users(id) on delete set null,
  source_node_id uuid references public.nodes(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  source_ai_run_id uuid references public.ai_runs(id) on delete set null,
  origin_key text,
  reason text,
  confidence real check (confidence is null or confidence between 0 and 1),
  source_locator jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'proposed', 'rejected', 'retracted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retracted_at timestamptz
);

create unique index edge_assertions_live_origin_unique
  on public.edge_assertions(owner_id, edge_id, provenance, origin_key)
  where retracted_at is null and origin_key is not null;
create index edge_assertions_edge_idx on public.edge_assertions(edge_id, created_at desc);

create table public.unresolved_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_note_id uuid not null references public.notes(node_id) on delete cascade,
  target_label text not null,
  normalized_label text not null,
  source_locations jsonb not null default '[]'::jsonb,
  candidate_node_ids uuid[] not null default '{}',
  content_version bigint not null,
  status text not null check (status in ('unresolved', 'ambiguous')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, source_note_id, normalized_label)
);

create table public.graph_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  assertion_id uuid references public.edge_assertions(id) on delete set null,
  node_id uuid references public.nodes(id) on delete set null,
  operation text not null check (operation in ('create_node', 'update_node', 'update_note', 'create_assertion', 'retract_assertion')),
  actor text not null check (actor in ('user', 'ai', 'system', 'markdown')),
  approval_state text not null default 'applied' check (approval_state in ('proposed', 'applied', 'rejected', 'undone')),
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create unique index graph_changes_idempotency_unique
  on public.graph_changes(owner_id, idempotency_key)
  where idempotency_key is not null;
create index graph_changes_activity_idx on public.graph_changes(owner_id, created_at desc);

create table public.node_content_chunks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null references public.nodes(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_hash text not null,
  embedding_model text not null default 'text-embedding-3-small',
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique(node_id, chunk_index, content_hash)
);

create or replace function public.normalize_graph_label(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.validate_node_extension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_type text := tg_argv[0];
  actual_owner uuid;
  actual_type text;
begin
  select owner_id, type into actual_owner, actual_type
  from public.nodes where id = new.node_id;
  if actual_owner is null or actual_owner <> new.owner_id or actual_type <> expected_type then
    raise exception 'invalid_node_extension' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger notes_validate_node before insert or update on public.notes
for each row execute function public.validate_node_extension('note');
create trigger conversations_validate_node before insert or update on public.conversations
for each row execute function public.validate_node_extension('conversation');

create or replace function public.validate_edge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_owner uuid;
  target_owner uuid;
  source_type text;
  target_type text;
  relationship public.relationship_types%rowtype;
  swap_id uuid;
begin
  select * into relationship from public.relationship_types where name = new.relationship_type;
  select owner_id, type into source_owner, source_type from public.nodes where id = new.source_node_id and archived_at is null;
  select owner_id, type into target_owner, target_type from public.nodes where id = new.target_node_id and archived_at is null;
  if source_owner is null or target_owner is null or source_owner <> new.owner_id or target_owner <> new.owner_id then
    raise exception 'invalid_edge_owner' using errcode = '42501';
  end if;
  if relationship.allowed_source_types is not null and not (source_type = any(relationship.allowed_source_types)) then
    raise exception 'invalid_source_type' using errcode = '23514';
  end if;
  if relationship.allowed_target_types is not null and not (target_type = any(relationship.allowed_target_types)) then
    raise exception 'invalid_target_type' using errcode = '23514';
  end if;
  if relationship.is_symmetric and new.source_node_id::text > new.target_node_id::text then
    swap_id := new.source_node_id;
    new.source_node_id := new.target_node_id;
    new.target_node_id := swap_id;
  end if;
  return new;
end;
$$;

create trigger edges_validate before insert or update on public.edges
for each row execute function public.validate_edge();

create or replace function public.prevent_part_of_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.relationship_type = 'part_of' and new.archived_at is null and exists (
    with recursive ancestors(id) as (
      select new.target_node_id
      union
      select e.target_node_id
      from public.edges e
      join ancestors a on e.source_node_id = a.id
      where e.owner_id = new.owner_id
        and e.relationship_type = 'part_of'
        and e.archived_at is null
        and e.id <> new.id
    )
    select 1 from ancestors where id = new.source_node_id
  ) then
    raise exception 'part_of_cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger edges_prevent_part_of_cycle before insert or update on public.edges
for each row execute function public.prevent_part_of_cycle();

create or replace function public.refresh_edge_lifecycle(assertion_edge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.edges e
  set archived_at = case
      when exists (
        select 1 from public.edge_assertions a
        where a.edge_id = assertion_edge_id and a.status = 'active' and a.retracted_at is null
      ) then null
      else coalesce(e.archived_at, now())
    end,
    updated_at = now()
  where e.id = assertion_edge_id;
end;
$$;

create or replace function public.edge_assertion_lifecycle_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_edge_lifecycle(coalesce(new.edge_id, old.edge_id));
  return coalesce(new, old);
end;
$$;

create trigger edge_assertions_refresh_edge
after insert or update or delete on public.edge_assertions
for each row execute function public.edge_assertion_lifecycle_trigger();

create trigger nodes_set_updated_at before update on public.nodes
for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
for each row execute function public.set_updated_at();
create trigger edges_set_updated_at before update on public.edges
for each row execute function public.set_updated_at();
create trigger edge_assertions_set_updated_at before update on public.edge_assertions
for each row execute function public.set_updated_at();
create trigger unresolved_links_set_updated_at before update on public.unresolved_links
for each row execute function public.set_updated_at();

alter table public.relationship_types enable row level security;
alter table public.nodes enable row level security;
alter table public.notes enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.node_aliases enable row level security;
alter table public.ai_runs enable row level security;
alter table public.edges enable row level security;
alter table public.edge_assertions enable row level security;
alter table public.unresolved_links enable row level security;
alter table public.graph_changes enable row level security;
alter table public.node_content_chunks enable row level security;

create policy relationship_types_read on public.relationship_types for select to authenticated using (true);
create policy own_nodes_read on public.nodes for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_notes_read on public.notes for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_conversations_read on public.conversations for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_messages_read on public.messages for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_aliases_read on public.node_aliases for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_ai_runs_read on public.ai_runs for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_edges_read on public.edges for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_assertions_read on public.edge_assertions for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_unresolved_links_read on public.unresolved_links for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_graph_changes_read on public.graph_changes for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_chunks_read on public.node_content_chunks for select to authenticated using ((select auth.uid()) = owner_id);

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.nodes, public.notes, public.conversations, public.messages,
  public.node_aliases, public.ai_runs, public.edges, public.edge_assertions, public.unresolved_links,
  public.graph_changes, public.node_content_chunks from authenticated;
grant select on public.relationship_types, public.nodes, public.notes, public.conversations, public.messages,
  public.node_aliases, public.ai_runs, public.edges, public.edge_assertions, public.unresolved_links,
  public.graph_changes, public.node_content_chunks to authenticated;
grant all on all tables in schema public to service_role;

create or replace function public.create_entity(
  p_type text,
  p_title text,
  p_summary text default null,
  p_markdown text default null,
  p_actor text default 'user',
  p_ai_run_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  created public.nodes%rowtype;
  prior jsonb;
begin
  if owner is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_type not in ('note', 'project', 'topic', 'person', 'conversation') then
    raise exception 'invalid_node_type' using errcode = '23514';
  end if;
  if p_actor not in ('user', 'ai', 'system') then raise exception 'invalid_actor' using errcode = '23514'; end if;
  if p_idempotency_key is not null then
    select after_snapshot into prior from public.graph_changes
    where owner_id = owner and idempotency_key = p_idempotency_key;
    if prior is not null then return prior; end if;
  end if;
  insert into public.nodes(owner_id, type, title, summary)
  values(owner, p_type, btrim(p_title), nullif(btrim(p_summary), '')) returning * into created;
  if p_type = 'note' then
    insert into public.notes(node_id, owner_id, markdown) values(created.id, owner, coalesce(p_markdown, ''));
  elsif p_type = 'conversation' then
    insert into public.conversations(node_id, owner_id) values(created.id, owner);
  end if;
  if p_type <> 'conversation' then
    insert into public.graph_changes(owner_id, ai_run_id, node_id, operation, actor, reason, after_snapshot, idempotency_key)
    values(owner, p_ai_run_id, created.id, 'create_node', p_actor, 'Created ' || p_type, to_jsonb(created), p_idempotency_key);
  end if;
  return to_jsonb(created);
end;
$$;

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
  select * into before_row from public.nodes where id = p_node_id and owner_id = owner and archived_at is null;
  if before_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if before_row.version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
  update public.nodes set title = btrim(p_title), summary = nullif(btrim(p_summary), ''), version = version + 1
  where id = p_node_id returning * into after_row;
  insert into public.graph_changes(owner_id, node_id, operation, actor, before_snapshot, after_snapshot)
  values(owner, p_node_id, 'update_node', 'user', to_jsonb(before_row), to_jsonb(after_row));
  return to_jsonb(after_row);
end;
$$;

create or replace function public.ensure_semantic_edge(
  p_owner uuid,
  p_source_node_id uuid,
  p_target_node_id uuid,
  p_relationship_type text
)
returns public.edges
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.edges%rowtype;
  symmetric_value boolean;
  source_id uuid := p_source_node_id;
  target_id uuid := p_target_node_id;
  swap_id uuid;
begin
  select is_symmetric into symmetric_value from public.relationship_types where name = p_relationship_type;
  if symmetric_value is null then raise exception 'invalid_relationship' using errcode = '23503'; end if;
  if symmetric_value and source_id::text > target_id::text then
    swap_id := source_id; source_id := target_id; target_id := swap_id;
  end if;
  select * into result from public.edges
  where owner_id = p_owner and source_node_id = source_id and target_node_id = target_id
    and relationship_type = p_relationship_type
  order by (archived_at is null) desc, created_at desc limit 1;
  if result.id is null then
    insert into public.edges(owner_id, source_node_id, target_node_id, relationship_type)
    values(p_owner, source_id, target_id, p_relationship_type) returning * into result;
  elsif result.archived_at is not null then
    update public.edges set archived_at = null where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

create or replace function public.create_edge_assertion(
  p_source_node_id uuid,
  p_target_node_id uuid,
  p_relationship_type text,
  p_provenance text default 'user',
  p_reason text default null,
  p_confidence real default null,
  p_origin_key text default null,
  p_source_locator jsonb default '{}'::jsonb,
  p_ai_run_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  semantic_edge public.edges%rowtype;
  assertion public.edge_assertions%rowtype;
  prior jsonb;
begin
  if owner is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_provenance not in ('user', 'ai', 'system', 'ingestion') then
    raise exception 'invalid_provenance' using errcode = '23514';
  end if;
  if p_idempotency_key is not null then
    select after_snapshot into prior from public.graph_changes
    where owner_id = owner and idempotency_key = p_idempotency_key;
    if prior is not null then return prior; end if;
  end if;
  semantic_edge := public.ensure_semantic_edge(owner, p_source_node_id, p_target_node_id, p_relationship_type);
  insert into public.edge_assertions(
    owner_id, edge_id, provenance, actor_id, source_ai_run_id, origin_key, reason, confidence, source_locator
  ) values(
    owner, semantic_edge.id, p_provenance, owner, p_ai_run_id, p_origin_key, p_reason, p_confidence, coalesce(p_source_locator, '{}'::jsonb)
  )
  on conflict (owner_id, edge_id, provenance, origin_key) where retracted_at is null and origin_key is not null
  do update set reason = excluded.reason, confidence = excluded.confidence,
    source_locator = excluded.source_locator, updated_at = now()
  returning * into assertion;
  insert into public.graph_changes(owner_id, ai_run_id, assertion_id, operation, actor, reason, after_snapshot, idempotency_key)
  values(owner, p_ai_run_id, assertion.id, 'create_assertion', case when p_provenance = 'ai' then 'ai' else 'user' end,
    p_reason, jsonb_build_object('edge', to_jsonb(semantic_edge), 'assertion', to_jsonb(assertion)), p_idempotency_key);
  return jsonb_build_object('edge', to_jsonb(semantic_edge), 'assertion', to_jsonb(assertion));
end;
$$;

create or replace function public.retract_edge_assertion(
  p_assertion_id uuid,
  p_reason text default null,
  p_ai_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  before_row public.edge_assertions%rowtype;
  after_row public.edge_assertions%rowtype;
begin
  select * into before_row from public.edge_assertions
  where id = p_assertion_id and owner_id = owner and retracted_at is null;
  if before_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.edge_assertions set status = 'retracted', retracted_at = now(), reason = coalesce(p_reason, reason)
  where id = p_assertion_id returning * into after_row;
  insert into public.graph_changes(owner_id, ai_run_id, assertion_id, operation, actor, reason, before_snapshot, after_snapshot)
  values(owner, p_ai_run_id, p_assertion_id, 'retract_assertion', case when p_ai_run_id is null then 'user' else 'ai' end,
    p_reason, to_jsonb(before_row), to_jsonb(after_row));
  return to_jsonb(after_row);
end;
$$;

create or replace function public.reconcile_note_links(
  p_note_id uuid,
  p_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  note_version bigint;
  link_record record;
  candidates uuid[];
  target_id uuid;
  semantic_edge public.edges%rowtype;
  keep_keys text[] := array[]::text[];
  origin text;
  resolved_count integer := 0;
  unresolved_count integer := 0;
begin
  select content_version into note_version from public.notes where node_id = p_note_id and owner_id = owner;
  if note_version is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.unresolved_links where owner_id = owner and source_note_id = p_note_id;
  for link_record in
    select public.normalize_graph_label(value->>'label') normalized_label,
      min(value->>'label') label,
      jsonb_agg(value order by (value->>'start')::integer) locations
    from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) value
    where nullif(btrim(value->>'label'), '') is not null
    group by public.normalize_graph_label(value->>'label')
  loop
    select array_agg(id order by id) into candidates from (
      select n.id from public.nodes n
      where n.owner_id = owner and n.archived_at is null
        and (
          public.normalize_graph_label(n.title) = link_record.normalized_label
          or exists (
            select 1 from public.node_aliases a
            where a.node_id = n.id and a.owner_id = owner and a.normalized_alias = link_record.normalized_label
          )
        )
    ) matches;
    if coalesce(array_length(candidates, 1), 0) = 1 then
      target_id := candidates[1];
      if target_id <> p_note_id then
        semantic_edge := public.ensure_semantic_edge(owner, p_note_id, target_id, 'references');
        origin := 'wiki:' || p_note_id::text || ':' || target_id::text;
        keep_keys := array_append(keep_keys, origin);
        insert into public.edge_assertions(
          owner_id, edge_id, provenance, actor_id, source_node_id, origin_key, reason, source_locator
        ) values(
          owner, semantic_edge.id, 'markdown', owner, p_note_id, origin,
          'Wiki-link in ' || link_record.label,
          jsonb_build_object('note_id', p_note_id, 'content_version', note_version, 'mentions', link_record.locations)
        )
        on conflict (owner_id, edge_id, provenance, origin_key) where retracted_at is null and origin_key is not null
        do update set source_locator = excluded.source_locator, reason = excluded.reason,
          status = 'active', retracted_at = null, updated_at = now()
        ;
        resolved_count := resolved_count + 1;
      end if;
    else
      insert into public.unresolved_links(
        owner_id, source_note_id, target_label, normalized_label, source_locations,
        candidate_node_ids, content_version, status
      ) values(
        owner, p_note_id, link_record.label, link_record.normalized_label, link_record.locations,
        coalesce(candidates, array[]::uuid[]), note_version,
        case when coalesce(array_length(candidates, 1), 0) = 0 then 'unresolved' else 'ambiguous' end
      );
      unresolved_count := unresolved_count + 1;
    end if;
  end loop;
  update public.edge_assertions
  set status = 'retracted', retracted_at = now()
  where owner_id = owner and provenance = 'markdown' and source_node_id = p_note_id
    and retracted_at is null and not (origin_key = any(keep_keys));
  update public.notes set parsed_at = now() where node_id = p_note_id;
  return jsonb_build_object('resolved', resolved_count, 'unresolved', unresolved_count);
end;
$$;

create or replace function public.update_note(
  p_node_id uuid,
  p_markdown text,
  p_expected_content_version bigint,
  p_links jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  before_row public.notes%rowtype;
  after_row public.notes%rowtype;
begin
  select * into before_row from public.notes where node_id = p_node_id and owner_id = owner;
  if before_row.node_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if before_row.content_version <> p_expected_content_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  update public.notes
  set markdown = p_markdown, content_version = content_version + 1, parsed_at = null
  where node_id = p_node_id returning * into after_row;
  perform public.reconcile_note_links(p_node_id, p_links);
  insert into public.graph_changes(owner_id, node_id, operation, actor, before_snapshot, after_snapshot)
  values(owner, p_node_id, 'update_note', 'user', to_jsonb(before_row), to_jsonb(after_row));
  return to_jsonb(after_row);
end;
$$;

create or replace function public.search_nodes(
  p_query text default '',
  p_types text[] default null,
  p_limit integer default 25
)
returns setof public.nodes
language sql
security definer
set search_path = ''
as $$
  select n.* from public.nodes n
  where n.owner_id = auth.uid() and n.archived_at is null
    and (p_types is null or n.type = any(p_types))
    and (
      nullif(btrim(p_query), '') is null
      or n.title ilike '%' || p_query || '%'
      or coalesce(n.summary, '') ilike '%' || p_query || '%'
      or exists (select 1 from public.node_aliases a where a.node_id = n.id and a.alias ilike '%' || p_query || '%')
    )
  order by case when public.normalize_graph_label(n.title) = public.normalize_graph_label(p_query) then 0 else 1 end,
    n.updated_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.get_node_bundle(p_node_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'node', to_jsonb(n),
    'note', (select to_jsonb(no) from public.notes no where no.node_id = n.id),
    'conversation', (select to_jsonb(c) from public.conversations c where c.node_id = n.id),
    'aliases', coalesce((select jsonb_agg(to_jsonb(a) order by a.alias) from public.node_aliases a where a.node_id = n.id), '[]'::jsonb),
    'unresolved_links', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at) from public.unresolved_links u where u.source_note_id = n.id), '[]'::jsonb)
  )
  from public.nodes n where n.id = p_node_id and n.owner_id = auth.uid();
$$;

create or replace function public.get_neighborhood(
  p_node_id uuid,
  p_relationship_types text[] default null,
  p_direction text default 'both',
  p_limit integer default 100
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with selected_edges as (
    select e.* from public.edges e
    where e.owner_id = auth.uid() and e.archived_at is null
      and (p_relationship_types is null or e.relationship_type = any(p_relationship_types))
      and ((p_direction in ('both', 'outgoing') and e.source_node_id = p_node_id)
        or (p_direction in ('both', 'incoming') and e.target_node_id = p_node_id))
    order by e.updated_at desc
    limit least(greatest(p_limit, 1), 100)
  ), node_ids as (
    select p_node_id id union select source_node_id from selected_edges union select target_node_id from selected_edges
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(to_jsonb(n) order by n.title) from public.nodes n join node_ids i on i.id = n.id where n.owner_id = auth.uid()), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from selected_edges e), '[]'::jsonb),
    'assertions', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.edge_assertions a join selected_edges e on e.id = a.edge_id), '[]'::jsonb)
  );
$$;

create or replace function public.traverse_graph(
  p_start_node_ids uuid[],
  p_max_depth integer default 2,
  p_relationship_types text[] default null,
  p_direction text default 'both',
  p_node_limit integer default 50,
  p_edge_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if p_max_depth < 0 or p_max_depth > 3 or p_node_limit < 1 or p_node_limit > 50 or p_edge_limit < 1 or p_edge_limit > 100 then
    raise exception 'limit_exceeded' using errcode = '22023';
  end if;
  with recursive walk(node_id, depth, path_nodes, path_edges) as (
    select n.id, 0, array[n.id], '{}'::uuid[] from public.nodes n
    where n.owner_id = auth.uid() and n.archived_at is null and n.id = any(p_start_node_ids)
    union all
    select case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end,
      w.depth + 1,
      w.path_nodes || case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end,
      w.path_edges || e.id
    from walk w join public.edges e on e.owner_id = auth.uid() and e.archived_at is null
      and (p_relationship_types is null or e.relationship_type = any(p_relationship_types))
      and ((p_direction in ('both', 'outgoing') and e.source_node_id = w.node_id)
        or (p_direction in ('both', 'incoming') and e.target_node_id = w.node_id))
    where w.depth < p_max_depth
      and not (case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end = any(w.path_nodes))
  ), bounded_walk as (
    select * from walk order by depth, node_id limit p_node_limit
  ), edge_ids as (
    select distinct unnest(path_edges) id from bounded_walk limit p_edge_limit
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(to_jsonb(n) order by n.title) from public.nodes n where n.id in (select node_id from bounded_walk)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.edges e where e.id in (select id from edge_ids)), '[]'::jsonb),
    'paths', coalesce((select jsonb_agg(jsonb_build_object('node_id', node_id, 'depth', depth, 'node_ids', path_nodes, 'edge_ids', path_edges)) from bounded_walk), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.undo_graph_change(p_change_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  change_row public.graph_changes%rowtype;
begin
  select * into change_row from public.graph_changes
  where id = p_change_id and owner_id = owner and approval_state = 'applied' and undone_at is null;
  if change_row.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if change_row.operation = 'create_assertion' and change_row.assertion_id is not null then
    update public.edge_assertions set status = 'retracted', retracted_at = now()
    where id = change_row.assertion_id and owner_id = owner and retracted_at is null;
  elsif change_row.operation = 'create_node' and change_row.node_id is not null then
    update public.nodes set archived_at = now(), version = version + 1
    where id = change_row.node_id and owner_id = owner and archived_at is null;
  else
    raise exception 'undo_not_supported' using errcode = '0A000';
  end if;
  update public.graph_changes set approval_state = 'undone', undone_at = now() where id = p_change_id;
  return jsonb_build_object('change_id', p_change_id, 'status', 'undone');
end;
$$;

revoke all on function public.ensure_semantic_edge(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_entity(text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.update_entity(uuid, text, text, bigint) to authenticated;
grant execute on function public.create_edge_assertion(uuid, uuid, text, text, text, real, text, jsonb, uuid, text) to authenticated;
grant execute on function public.retract_edge_assertion(uuid, text, uuid) to authenticated;
grant execute on function public.reconcile_note_links(uuid, jsonb) to authenticated;
grant execute on function public.update_note(uuid, text, bigint, jsonb) to authenticated;
grant execute on function public.search_nodes(text, text[], integer) to authenticated;
grant execute on function public.get_node_bundle(uuid) to authenticated;
grant execute on function public.get_neighborhood(uuid, text[], text, integer) to authenticated;
grant execute on function public.traverse_graph(uuid[], integer, text[], text, integer, integer) to authenticated;
grant execute on function public.undo_graph_change(uuid) to authenticated;

comment on table public.edges is 'One canonical semantic relationship; provenance lives in edge_assertions.';
comment on table public.edge_assertions is 'Independent, inspectable supports for a semantic edge.';
comment on table public.node_content_chunks is 'Optional embedding retrieval foundation; embeddings never create edges automatically.';
