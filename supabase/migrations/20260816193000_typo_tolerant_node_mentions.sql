create extension if not exists pg_trgm with schema extensions;

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
      0 as label_priority,
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
      1 as label_priority,
      regexp_replace(lower(a.alias), '[^[:alnum:]]+', ' ', 'g') as normalized_label
    from public.node_aliases a
    join public.nodes n on n.id = a.node_id
    where n.owner_id = auth.uid()
      and n.archived_at is null
      and n.type not in ('conversation', 'memory')
  ), scored as (
    select
      labels.*,
      position(
        ' ' || btrim(labels.normalized_label) || ' '
        in ' ' || btrim(input.normalized_text) || ' '
      ) > 0 as is_exact,
      extensions.strict_word_similarity(
        btrim(labels.normalized_label),
        btrim(input.normalized_text)
      ) as similarity_score
    from labels
    cross join input
    where char_length(btrim(labels.normalized_label)) >= 3
  ), matches as (
    select distinct on (scored.id)
      scored.*,
      case
        when scored.is_exact and scored.label_priority = 0 then 'explicit_title'
        when scored.is_exact then 'explicit_alias'
        when scored.label_priority = 0 then 'typo_title'
        else 'typo_alias'
      end as match_reason,
      case
        when scored.is_exact then scored.label_priority
        else scored.label_priority + 2
      end as match_priority
    from scored
    where scored.is_exact
      or (
        char_length(btrim(scored.normalized_label)) >= 5
        and scored.similarity_score >= case
          when char_length(btrim(scored.normalized_label)) <= 5 then 0.85
          else 0.78
        end
      )
    order by
      scored.id,
      scored.is_exact desc,
      scored.label_priority,
      scored.similarity_score desc,
      char_length(scored.normalized_label) desc
  ), limited as (
    select *
    from matches
    order by match_priority, similarity_score desc, char_length(normalized_label) desc, updated_at desc
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
        'match_score', case when limited.is_exact then 1 else limited.similarity_score end,
        'explicit_mention', true
      )
      order by limited.match_priority, limited.similarity_score desc, char_length(limited.normalized_label) desc, limited.updated_at desc
    ),
    '[]'::jsonb
  )
  from limited;
$$;

comment on function public.resolve_explicit_node_mentions(text, integer) is
  'Resolves exact or conservatively typo-matched whole title and alias mentions to active non-conversation, non-Memory nodes owned by the caller.';
