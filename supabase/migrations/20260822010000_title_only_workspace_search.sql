begin;

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
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as query
  )
  select n.*
  from public.nodes n
  cross join input i
  where n.owner_id = auth.uid()
    and n.archived_at is null
    and (p_types is null or n.type = any(p_types))
    and (i.query = '' or strpos(lower(n.title), i.query) > 0)
  order by
    case
      when i.query = '' then 0
      when lower(n.title) = i.query then 0
      when left(lower(n.title), char_length(i.query)) = i.query then 1
      else 2
    end,
    n.updated_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.search_nodes(text, text[], integer)
  is 'Owner-scoped workspace palette search. Empty query returns recent nodes; non-empty query matches titles only and ranks exact, prefix, then contains.';

commit;
