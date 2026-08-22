-- Durable, incremental conversation summaries and bounded message retrieval.
-- Nodes already own created_at/updated_at; the triggers below make updated_at
-- accurately reflect extension and child-record activity.

alter table public.messages
  add column if not exists sequence bigint generated always as identity;

create unique index if not exists messages_conversation_sequence_unique
  on public.messages(conversation_id, sequence);

create table public.conversation_summaries (
  conversation_id uuid primary key references public.conversations(node_id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  summary text not null default '',
  topics text[] not null default '{}',
  decisions jsonb not null default '[]'::jsonb,
  open_loops jsonb not null default '[]'::jsonb,
  salient_facts jsonb not null default '[]'::jsonb,
  message_count integer not null default 0 check (message_count >= 0),
  through_message_id uuid references public.messages(id) on delete set null,
  through_message_sequence bigint,
  through_message_created_at timestamptz,
  source_hash text,
  summary_version integer not null default 0 check (summary_version >= 0),
  model text,
  status text not null default 'stale' check (status in ('stale', 'current', 'error')),
  last_error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversation_summaries_owner_updated_idx
  on public.conversation_summaries(owner_id, updated_at desc);
create index messages_content_search_idx
  on public.messages using gin (to_tsvector('simple', content));

alter table public.conversation_summaries enable row level security;
create policy conversation_summaries_select_own
on public.conversation_summaries for select
using (owner_id = auth.uid());

revoke all on public.conversation_summaries from public, anon;
revoke insert, update, delete on public.conversation_summaries from authenticated;
grant select on public.conversation_summaries to authenticated;
grant all on public.conversation_summaries to service_role;

create trigger conversation_summaries_set_updated_at
before update on public.conversation_summaries
for each row execute function public.set_updated_at();

create or replace function public.touch_note_parent_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.nodes
  set updated_at = greatest(updated_at, new.updated_at),
      version = version + 1
  where id = new.node_id and owner_id = new.owner_id;
  return new;
end;
$$;

drop trigger if exists notes_touch_parent_node on public.notes;
create trigger notes_touch_parent_node
after update of markdown, content_version on public.notes
for each row
when (
  old.markdown is distinct from new.markdown
  or old.content_version is distinct from new.content_version
)
execute function public.touch_note_parent_node();

create or replace function public.touch_conversation_for_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.nodes
  set updated_at = greatest(updated_at, new.created_at),
      version = version + 1
  where id = new.conversation_id and owner_id = new.owner_id;

  update public.conversations
  set updated_at = greatest(updated_at, new.created_at)
  where node_id = new.conversation_id and owner_id = new.owner_id;

  update public.conversation_summaries
  set status = 'stale'
  where conversation_id = new.conversation_id and owner_id = new.owner_id;

  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_for_message();

create or replace function public.search_conversation_messages(
  p_conversation_id uuid,
  p_query text,
  p_limit integer default 8
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
  ), ranked as (
    select m.id, m.conversation_id, m.sequence, m.role, m.created_at,
           left(m.content, 2400) as excerpt,
           case
             when q.ts_query is null then 0.0
             else ts_rank_cd(to_tsvector('simple', m.content), q.ts_query)
           end as rank
    from public.messages m
    cross join query_parts q
    where m.owner_id = auth.uid()
      and m.conversation_id = p_conversation_id
      and exists (
        select 1 from public.conversations c
        where c.node_id = p_conversation_id and c.owner_id = auth.uid()
      )
      and (
        q.ts_query is null
        or to_tsvector('simple', m.content) @@ q.ts_query
        or m.content ilike '%' || q.query_text || '%'
      )
    order by rank desc, m.sequence desc
    limit least(greatest(p_limit, 1), 20)
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rank desc, r.created_at desc), '[]'::jsonb)
  from ranked r;
$$;

create or replace function public.get_message_context(
  p_message_id uuid,
  p_before integer default 2,
  p_after integer default 2
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select id, conversation_id
    from public.messages
    where id = p_message_id and owner_id = auth.uid()
  ), ordered as (
    select m.id, m.conversation_id, m.sequence, m.role, m.content, m.created_at,
           row_number() over (order by m.sequence) as position
    from public.messages m
    join target t on t.conversation_id = m.conversation_id
    where m.owner_id = auth.uid()
  ), target_position as (
    select o.position, o.conversation_id
    from ordered o where o.id = p_message_id
  ), bounded as (
    select o.*
    from ordered o
    cross join target_position t
    where o.position between
      t.position - least(greatest(p_before, 0), 5)
      and t.position + least(greatest(p_after, 0), 5)
    order by o.position
  )
  select jsonb_build_object(
    'conversation_id', (select conversation_id from target_position),
    'anchor_message_id', p_message_id,
    'messages', coalesce((select jsonb_agg(to_jsonb(b) order by b.position) from bounded b), '[]'::jsonb)
  );
$$;

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
    'summary', case when cs.conversation_id is null then null else to_jsonb(cs) end
  )
  from public.conversations c
  join public.nodes n on n.id = c.node_id and n.owner_id = auth.uid()
  left join public.conversation_summaries cs on cs.conversation_id = c.node_id
  where c.node_id = p_conversation_id and c.owner_id = auth.uid();
$$;

create or replace function public.get_node_bundle(p_node_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'node', to_jsonb(n),
    'note', (select to_jsonb(no) from public.notes no where no.node_id = n.id),
    'conversation', (select to_jsonb(c) from public.conversations c where c.node_id = n.id),
    'conversation_summary', (select to_jsonb(cs) from public.conversation_summaries cs where cs.conversation_id = n.id),
    'aliases', coalesce((select jsonb_agg(to_jsonb(a) order by a.alias) from public.node_aliases a where a.node_id = n.id), '[]'::jsonb),
    'unresolved_links', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at) from public.unresolved_links u where u.source_note_id = n.id), '[]'::jsonb)
  )
  from public.nodes n where n.id = p_node_id and n.owner_id = auth.uid();
$$;

revoke all on function public.search_conversation_messages(uuid, text, integer) from public, anon;
revoke all on function public.get_message_context(uuid, integer, integer) from public, anon;
revoke all on function public.get_conversation_summary(uuid) from public, anon;
grant execute on function public.search_conversation_messages(uuid, text, integer) to authenticated;
grant execute on function public.get_message_context(uuid, integer, integer) to authenticated;
grant execute on function public.get_conversation_summary(uuid) to authenticated;

comment on table public.conversation_summaries is
  'Versioned incremental summaries with message cursors and inspectable structured claims.';
comment on function public.search_conversation_messages(uuid, text, integer) is
  'Ranks bounded excerpts inside one already-selected conversation; it never dumps the whole conversation.';
comment on function public.get_message_context(uuid, integer, integer) is
  'Loads a small ordered window around one provenance or search-selected message.';
