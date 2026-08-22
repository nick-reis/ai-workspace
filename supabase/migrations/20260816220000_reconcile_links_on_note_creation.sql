create or replace function public.create_note(
  p_title text,
  p_summary text default null,
  p_markdown text default '',
  p_links jsonb default '[]'::jsonb,
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
  created jsonb;
  created_id uuid;
begin
  created := public.create_entity(
    'note',
    p_title,
    p_summary,
    coalesce(p_markdown, ''),
    p_actor,
    p_ai_run_id,
    p_idempotency_key
  );
  created_id := (created->>'id')::uuid;
  perform public.reconcile_note_links(created_id, coalesce(p_links, '[]'::jsonb));
  return created;
end;
$$;

revoke all on function public.create_note(text, text, text, jsonb, text, uuid, text)
  from public, anon;
grant execute on function public.create_note(text, text, text, jsonb, text, uuid, text)
  to authenticated;

comment on function public.create_note(text, text, text, jsonb, text, uuid, text) is
  'Creates a note and transactionally reconciles its initial Markdown wiki-links.';
