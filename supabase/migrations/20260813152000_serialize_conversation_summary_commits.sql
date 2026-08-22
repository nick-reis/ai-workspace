begin;

create or replace function public.save_conversation_summary(
  p_conversation_id uuid,
  p_expected_previous_sequence bigint,
  p_summary text,
  p_topics text[],
  p_decisions jsonb,
  p_open_loops jsonb,
  p_salient_facts jsonb,
  p_through_message_id uuid,
  p_through_message_sequence bigint,
  p_through_message_created_at timestamptz,
  p_source_hash text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_existing public.conversation_summaries%rowtype;
  v_saved public.conversation_summaries%rowtype;
  v_message_count integer;
  v_has_newer boolean;
begin
  -- Message insertion touches this same row, so it cannot race a summary commit.
  select owner_id into v_owner_id
  from public.conversations
  where node_id = p_conversation_id
  for update;

  if v_owner_id is null then
    raise exception 'Conversation not found';
  end if;

  select * into v_existing
  from public.conversation_summaries
  where conversation_id = p_conversation_id
  for update;

  if coalesce(v_existing.through_message_sequence, 0) <> coalesce(p_expected_previous_sequence, 0) then
    return to_jsonb(v_existing) || jsonb_build_object('saved', false, 'conflict', true);
  end if;

  if not exists (
    select 1 from public.messages
    where id = p_through_message_id
      and conversation_id = p_conversation_id
      and owner_id = v_owner_id
      and sequence = p_through_message_sequence
  ) then
    raise exception 'Summary cursor message does not belong to the conversation';
  end if;

  select count(*)::integer into v_message_count
  from public.messages
  where conversation_id = p_conversation_id and owner_id = v_owner_id;

  select exists (
    select 1 from public.messages
    where conversation_id = p_conversation_id
      and owner_id = v_owner_id
      and sequence > p_through_message_sequence
  ) into v_has_newer;

  insert into public.conversation_summaries (
    conversation_id, owner_id, summary, topics, decisions, open_loops,
    salient_facts, message_count, through_message_id,
    through_message_sequence, through_message_created_at, source_hash,
    summary_version, model, status, last_error, generated_at
  ) values (
    p_conversation_id, v_owner_id, left(p_summary, 4000), coalesce(p_topics, '{}'::text[]),
    coalesce(p_decisions, '[]'::jsonb), coalesce(p_open_loops, '[]'::jsonb),
    coalesce(p_salient_facts, '[]'::jsonb), v_message_count, p_through_message_id,
    p_through_message_sequence, p_through_message_created_at, p_source_hash,
    coalesce(v_existing.summary_version, 0) + 1, p_model,
    case when v_has_newer then 'stale' else 'current' end, null, now()
  )
  on conflict (conversation_id) do update set
    summary = excluded.summary,
    topics = excluded.topics,
    decisions = excluded.decisions,
    open_loops = excluded.open_loops,
    salient_facts = excluded.salient_facts,
    message_count = excluded.message_count,
    through_message_id = excluded.through_message_id,
    through_message_sequence = excluded.through_message_sequence,
    through_message_created_at = excluded.through_message_created_at,
    source_hash = excluded.source_hash,
    summary_version = excluded.summary_version,
    model = excluded.model,
    status = excluded.status,
    last_error = null,
    generated_at = excluded.generated_at
  returning * into v_saved;

  update public.nodes
  set summary = left(p_summary, 4000), version = version + 1
  where id = p_conversation_id and owner_id = v_owner_id;

  return to_jsonb(v_saved) || jsonb_build_object('saved', true, 'conflict', false);
end;
$$;

revoke all on function public.save_conversation_summary(uuid, bigint, text, text[], jsonb, jsonb, jsonb, uuid, bigint, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.save_conversation_summary(uuid, bigint, text, text[], jsonb, jsonb, jsonb, uuid, bigint, timestamptz, text, text) to service_role;

comment on function public.save_conversation_summary(uuid, bigint, text, text[], jsonb, jsonb, jsonb, uuid, bigint, timestamptz, text, text) is
  'Serializes summary commits per conversation, rejects stale cursors, and atomically preserves staleness when newer messages exist.';

commit;
