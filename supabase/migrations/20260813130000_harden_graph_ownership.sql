create or replace function public.validate_edge_assertion_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.edges e where e.id = new.edge_id and e.owner_id = new.owner_id) then
    raise exception 'invalid_assertion_edge_owner' using errcode = '42501';
  end if;
  if new.source_node_id is not null and not exists (select 1 from public.nodes n where n.id = new.source_node_id and n.owner_id = new.owner_id) then
    raise exception 'invalid_assertion_node_owner' using errcode = '42501';
  end if;
  if new.source_message_id is not null and not exists (select 1 from public.messages m where m.id = new.source_message_id and m.owner_id = new.owner_id) then
    raise exception 'invalid_assertion_message_owner' using errcode = '42501';
  end if;
  if new.source_ai_run_id is not null and not exists (select 1 from public.ai_runs r where r.id = new.source_ai_run_id and r.owner_id = new.owner_id) then
    raise exception 'invalid_assertion_run_owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger edge_assertions_validate_owner
before insert or update on public.edge_assertions
for each row execute function public.validate_edge_assertion_owner();

create or replace function public.validate_graph_change_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_run_id is not null and not exists (select 1 from public.ai_runs r where r.id = new.ai_run_id and r.owner_id = new.owner_id) then
    raise exception 'invalid_change_run_owner' using errcode = '42501';
  end if;
  if new.assertion_id is not null and not exists (select 1 from public.edge_assertions a where a.id = new.assertion_id and a.owner_id = new.owner_id) then
    raise exception 'invalid_change_assertion_owner' using errcode = '42501';
  end if;
  if new.node_id is not null and not exists (select 1 from public.nodes n where n.id = new.node_id and n.owner_id = new.owner_id) then
    raise exception 'invalid_change_node_owner' using errcode = '42501';
  end if;
  if new.actor = 'ai' and new.ai_run_id is null then
    raise exception 'ai_change_requires_run' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger graph_changes_validate_owner
before insert or update on public.graph_changes
for each row execute function public.validate_graph_change_owner();

revoke all on function public.refresh_edge_lifecycle(uuid) from public, anon, authenticated;
revoke all on function public.validate_edge_assertion_owner() from public, anon, authenticated;
revoke all on function public.validate_graph_change_owner() from public, anon, authenticated;

