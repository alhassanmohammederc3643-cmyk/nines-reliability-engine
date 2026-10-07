-- Nines engine preparation ONLY. Not applied to production. No worker, payment or alert adapter.
-- Expired leases are never evidence that an external effect did not occur.
alter table public.mini_nines_tasks add column if not exists lease_id uuid;
alter table public.mini_nines_tasks add column if not exists lease_until timestamptz;
alter table public.mini_nines_tasks add column if not exists effect_started_at timestamptz;
alter table public.mini_nines_tasks add column if not exists provider_request_id text;
alter table public.mini_nines_tasks add column if not exists reconciliation_required boolean not null default false;
create index if not exists mini_nines_due_lease_idx on public.mini_nines_tasks(state,deadline,lease_until);
-- A lease only guards preparation. NEVER reclaim a task after external effect_started_at.
create or replace function public.mini_nines_claim(p_owner text,p_task uuid,p_expected_version integer,p_lease uuid,p_seconds integer)
returns integer language plpgsql security invoker as $$
declare updated integer;
begin
 if p_owner is null or p_task is null or p_lease is null or p_seconds not between 10 and 300 then return 0; end if;
 update public.mini_nines_tasks set lease_id=p_lease,lease_until=now()+make_interval(secs=>p_seconds),version=version+1,updated_at=now()
 where id=p_task and user_email=p_owner and version=p_expected_version
 and state in ('PLANNED','AUTH_SCOPED','VERIFYING')
 and (lease_id is null or lease_until<now())
 and effect_started_at is null and not reconciliation_required and deadline>now();
 get diagnostics updated=row_count; return updated;
end; $$;
-- Heartbeat must prove the same owner, lease ID, version and unfinished deadline.
create or replace function public.mini_nines_renew(p_owner text,p_task uuid,p_expected_version integer,p_lease uuid,p_seconds integer)
returns integer language plpgsql security invoker as $$
declare updated integer;
begin
 if p_owner is null or p_task is null or p_lease is null or p_seconds not between 10 and 300 then return 0; end if;
 update public.mini_nines_tasks set lease_until=now()+make_interval(secs=>p_seconds),version=version+1,updated_at=now()
 where id=p_task and user_email=p_owner and version=p_expected_version and lease_id=p_lease and lease_until>now()
 and state in ('PLANNED','AUTH_SCOPED','VERIFYING') and effect_started_at is null and not reconciliation_required and deadline>now();
 get diagnostics updated=row_count; return updated;
end; $$;
-- This gate is a *record* before effects, not a payment authorization. Application must separately verify
-- owner approval, scope, final amount and provider idempotency before any future adapter calls.
create or replace function public.mini_nines_mark_effect(p_owner text,p_task uuid,p_expected_version integer,p_lease uuid,p_request_id text)
returns integer language plpgsql security invoker as $$
declare updated integer;
begin
 if p_owner is null or p_task is null or p_lease is null or p_request_id is null or char_length(p_request_id) not between 16 and 120 then return 0; end if;
 update public.mini_nines_tasks set effect_started_at=now(),provider_request_id=p_request_id,
 reconciliation_required=true,version=version+1,updated_at=now()
 where id=p_task and user_email=p_owner and version=p_expected_version and lease_id=p_lease and lease_until>now()
 and state='AUTH_SCOPED' and effect_started_at is null and not reconciliation_required and deadline>now();
 get diagnostics updated=row_count; return updated;
end; $$;
-- A crashed worker cannot make a possibly-charged task eligible again.
-- Reconciliation_required may only be cleared in a separate reviewed reconciliation operation, not here.
revoke all on function public.mini_nines_claim(text,uuid,integer,uuid,integer) from public,anon,authenticated;
revoke all on function public.mini_nines_renew(text,uuid,integer,uuid,integer) from public,anon,authenticated;
revoke all on function public.mini_nines_mark_effect(text,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.mini_nines_claim(text,uuid,integer,uuid,integer) to service_role;
grant execute on function public.mini_nines_renew(text,uuid,integer,uuid,integer) to service_role;
grant execute on function public.mini_nines_mark_effect(text,uuid,integer,uuid,text) to service_role;
