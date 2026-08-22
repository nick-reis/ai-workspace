begin;

alter table public.nodes drop constraint if exists nodes_type_check;

with legacy as (
  select id, owner_id, type as previous_type
  from public.nodes
  where type in ('project', 'topic', 'person')
), converted as (
  update public.nodes n
  set type = 'note', version = version + 1
  from legacy l
  where n.id = l.id
  returning n.id, n.owner_id, n.title, n.summary, n.version,
            n.created_at, n.updated_at, n.archived_at, l.previous_type
)
insert into public.graph_changes (
  owner_id, node_id, operation, actor, approval_state, reason,
  before_snapshot, after_snapshot
)
select owner_id, id, 'update_node', 'system', 'applied',
       'Converted removed ' || previous_type || ' node type to note.',
       jsonb_build_object('id', id, 'type', previous_type, 'title', title),
       jsonb_build_object(
         'id', id, 'type', 'note', 'title', title, 'summary', summary,
         'version', version, 'created_at', created_at,
         'updated_at', updated_at, 'archived_at', archived_at
       )
from converted;

insert into public.notes (node_id, owner_id, markdown)
select id, owner_id, ''
from public.nodes
where type = 'note'
on conflict (node_id) do nothing;

alter table public.nodes
  add constraint nodes_type_check
  check (type in ('note', 'conversation'));

update public.relationship_types
set allowed_source_types = array['conversation']::text[],
    allowed_target_types = array['note']::text[]
where name in ('discusses', 'produced');

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
  if p_type not in ('note', 'conversation') then
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

create or replace function public.relationship_proposal_conversation_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_request_message_id uuid;
  v_target_node_id uuid;
begin
  select conversation_id, request_message_id
  into v_conversation_id, v_request_message_id
  from public.ai_runs
  where id = new.ai_run_id and owner_id = new.owner_id;

  if v_conversation_id is null then
    return new;
  end if;

  foreach v_target_node_id in array array[new.source_node_id, new.target_node_id]
  loop
    if not exists (
      select 1 from public.nodes
      where id = v_target_node_id
        and owner_id = new.owner_id
        and type = 'note'
        and archived_at is null
    ) then
      continue;
    end if;

    if not exists (
      select 1
      from public.edges e
      join public.edge_assertions a on a.edge_id = e.id
      where e.owner_id = new.owner_id
        and e.source_node_id = v_conversation_id
        and e.target_node_id = v_target_node_id
        and e.relationship_type = 'produced'
        and e.archived_at is null
        and a.status = 'active'
        and a.retracted_at is null
    ) then
      perform public.ensure_conversation_context_edge(
        new.owner_id,
        v_conversation_id,
        v_target_node_id,
        'discusses',
        'Discussed while requesting ' || new.relationship_type || ' between ' ||
          new.source_node_id::text || ' and ' || new.target_node_id::text,
        new.ai_run_id,
        coalesce(new.source_message_id, v_request_message_id),
        jsonb_build_object(
          'conversation_id', v_conversation_id,
          'proposal_id', new.id,
          'relationship_type', new.relationship_type,
          'semantic_key', new.semantic_key
        ),
        'conversation-discusses:' || v_conversation_id::text || ':' || v_target_node_id::text
      );
    end if;
  end loop;

  return new;
end;
$$;

comment on constraint nodes_type_check on public.nodes is
  'V1 exposes only durable Markdown notes and persistent AI conversations.';
comment on function public.create_entity(text, text, text, text, text, uuid, text) is
  'Creates only note or conversation nodes; other domain types are deferred.';

commit;
