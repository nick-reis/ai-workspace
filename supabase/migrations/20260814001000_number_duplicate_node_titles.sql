begin;

create or replace function public.assign_unique_node_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested text := btrim(new.title);
  v_base text;
  v_candidate text;
  v_suffix text;
  v_normalized text;
  v_taken boolean;
  v_number integer := 2;
begin
  v_base := regexp_replace(v_requested, '\s+\([0-9]+\)$', '');
  if v_base = '' then
    v_base := v_requested;
  end if;

  -- Every variant of the same base shares a lock, so simultaneous inserts and
  -- renames cannot select the same numeric suffix.
  perform pg_advisory_xact_lock(hashtextextended(
    new.owner_id::text || ':node-title:' || public.normalize_graph_label(v_base),
    0
  ));

  v_candidate := v_requested;

  loop
    v_normalized := public.normalize_graph_label(v_candidate);

    select exists (
      select 1
      from public.nodes n
      where n.owner_id = new.owner_id
        and n.archived_at is null
        and (tg_op = 'INSERT' or n.id <> new.id)
        and public.normalize_graph_label(n.title) = v_normalized
    ) or exists (
      select 1
      from public.node_aliases a
      join public.nodes n on n.id = a.node_id and n.owner_id = a.owner_id
      where a.owner_id = new.owner_id
        and n.archived_at is null
        and (tg_op = 'INSERT' or n.id <> new.id)
        and a.normalized_alias = v_normalized
    ) into v_taken;

    if not v_taken then
      new.title := v_candidate;
      return new;
    end if;

    v_suffix := ' (' || v_number::text || ')';
    v_candidate := left(v_base, greatest(1, 240 - char_length(v_suffix))) || v_suffix;
    v_number := v_number + 1;
  end loop;
end;
$$;

drop trigger if exists nodes_assign_unique_title on public.nodes;
create trigger nodes_assign_unique_title
before insert or update of title, owner_id on public.nodes
for each row execute function public.assign_unique_node_title();

-- Preserve compatibility for an already-deployed Edge Function during rollout.
-- The canonical create_entity path now performs numbering through the node trigger.
create or replace function public.create_ai_entity_resolving_identity(
  p_type text,
  p_title text,
  p_summary text default null,
  p_markdown text default null,
  p_ai_run_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_created jsonb;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_ai_run_id is null or not exists (
    select 1 from public.ai_runs
    where id = p_ai_run_id and owner_id = v_owner
  ) then
    raise exception 'ai_run_not_found' using errcode = '42501';
  end if;

  v_created := public.create_entity(
    p_type,
    p_title,
    p_summary,
    p_markdown,
    'ai',
    p_ai_run_id,
    p_idempotency_key
  );

  return jsonb_build_object(
    'status', 'created',
    'reused', false,
    'id', v_created->>'id',
    'node', v_created,
    'candidates', '[]'::jsonb
  );
end;
$$;

revoke all on function public.assign_unique_node_title() from public, anon, authenticated;

comment on function public.assign_unique_node_title() is
  'Assigns an owner-wide active graph title using deterministic (2), (3), ... suffixes across every node type and creation path.';
comment on function public.create_ai_entity_resolving_identity(text, text, text, text, uuid, text) is
  'Compatibility wrapper for AI creation; duplicate titles are now numbered globally by the nodes trigger.';

commit;
