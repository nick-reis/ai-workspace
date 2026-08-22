create or replace function public.resolve_explicit_node_mentions(
  p_text text,
  p_limit integer default 8
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g') as normalized_text
  ), labels as (
    select
      n.id,
      n.type,
      n.title,
      n.summary,
      n.version,
      n.created_at,
      n.updated_at,
      n.title as matched_label,
      'explicit_title'::text as match_reason,
      0 as match_priority,
      regexp_replace(lower(n.title), '[^[:alnum:]]+', ' ', 'g') as normalized_label
    from public.nodes n
    where n.owner_id = auth.uid()
      and n.archived_at is null
      and n.type not in ('conversation', 'memory')

    union all

    select
      n.id,
      n.type,
      n.title,
      n.summary,
      n.version,
      n.created_at,
      n.updated_at,
      a.alias as matched_label,
      'explicit_alias'::text as match_reason,
      1 as match_priority,
      regexp_replace(lower(a.alias), '[^[:alnum:]]+', ' ', 'g') as normalized_label
    from public.node_aliases a
    join public.nodes n on n.id = a.node_id
    where n.owner_id = auth.uid()
      and n.archived_at is null
      and n.type not in ('conversation', 'memory')
  ), matches as (
    select distinct on (labels.id)
      labels.*
    from labels
    cross join input
    where char_length(btrim(labels.normalized_label)) >= 3
      and position(
        ' ' || btrim(labels.normalized_label) || ' '
        in ' ' || btrim(input.normalized_text) || ' '
      ) > 0
    order by labels.id, labels.match_priority, char_length(labels.normalized_label) desc
  ), limited as (
    select *
    from matches
    order by match_priority, char_length(normalized_label) desc, updated_at desc
    limit least(greatest(coalesce(p_limit, 8), 1), 12)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', limited.id,
        'type', limited.type,
        'title', limited.title,
        'summary', limited.summary,
        'version', limited.version,
        'created_at', limited.created_at,
        'updated_at', limited.updated_at,
        'matched_label', limited.matched_label,
        'match_reason', limited.match_reason,
        'explicit_mention', true
      )
      order by limited.match_priority, char_length(limited.normalized_label) desc, limited.updated_at desc
    ),
    '[]'::jsonb
  )
  from limited;
$$;

revoke all on function public.resolve_explicit_node_mentions(text, integer) from public;
grant execute on function public.resolve_explicit_node_mentions(text, integer) to authenticated;

comment on function public.resolve_explicit_node_mentions(text, integer) is
  'Resolves exact whole-title or alias mentions to active non-conversation, non-Memory nodes owned by the caller.';
