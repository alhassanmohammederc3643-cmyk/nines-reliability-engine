-- Nines preparation only. Apply only after owner approves this exact production migration.
-- Service-role-only tables; all application access must supply current_member().email as p_owner.
-- No charge or notification adapter is enabled by applying this migration.
create table if not exists public.mini_nines_tasks (
 id uuid primary key, user_email text not null,
 merchant_id text not null, amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency ~ '^[A-Z]{3}$'), order_id text not null,
 deadline timestamptz not null, pickup_at timestamptz not null,
 state text not null default 'PLANNED' check(state in ('PLANNED','AUTH_SCOPED','CHARGING','VERIFYING','VERIFIED','FAILED','SETTLEMENT_UNKNOWN')),
 idempotency_key text not null unique,
 scope_merchant_id text,scope_amount_minor bigint,scope_expires_at timestamptz,
 scope_instrument text check(scope_instrument in ('one_time_virtual_card','stripe_shared_payment_token')),
 -- Scope reference is an opaque provider token, NEVER card PAN/CVV.
 scope_reference text check(scope_reference is null or char_length(scope_reference)<=300),
 attempts integer not null default 0 check(attempts between 0 and 3),
 version integer not null default 1, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_email,id),unique(user_email,merchant_id,order_id)
);
create index if not exists mini_nines_owner_deadline_idx on public.mini_nines_tasks(user_email,state,deadline);
create table if not exists public.mini_nines_audit (
 id bigint generated always as identity primary key,task_id uuid not null,user_email text not null,
 from_state text not null,to_state text not null,reason text not null,attempt integer not null,
 receipt_message_id text,created_at timestamptz not null default now(),
 foreign key(user_email,task_id) references public.mini_nines_tasks(user_email,id)
);
create index if not exists mini_nines_audit_owner_idx on public.mini_nines_audit(user_email,task_id,id);
create table if not exists public.mini_nines_receipts (
 id uuid primary key,task_id uuid not null,user_email text not null,
 gmail_message_id text not null, sender_address text not null,received_at timestamptz not null,
 parsed_fields jsonb not null,match_status text not null check(match_status in ('MATCHED','MISMATCH','UNVERIFIED')),
 created_at timestamptz not null default now(),
 unique(user_email,gmail_message_id),foreign key(user_email,task_id) references public.mini_nines_tasks(user_email,id)
);
create table if not exists public.mini_nines_outbox (
 id uuid primary key,task_id uuid not null,user_email text not null,
 channel text not null check(channel in ('push','sms','in_chat','email')),
 payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','confirmed','failed','unknown')),
 provider_reference text,attempted_at timestamptz,confirmed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(user_email,task_id) references public.mini_nines_tasks(user_email,id)
);
create index if not exists mini_nines_outbox_pending_idx on public.mini_nines_outbox(user_email,status,created_at);
create table if not exists public.mini_nines_policies (
 user_email text primary key,enabled boolean not null default false,currency text not null check(currency ~ '^[A-Z]{3}$'),
 max_amount_minor bigint not null check(max_amount_minor>=0),min_lead_minutes integer not null check(min_lead_minutes>=0),
 merchant_ids text[] not null default '{}',expires_at timestamptz,revision integer not null default 1,
 owner_evidence_ref text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(not enabled or (max_amount_minor>0 and cardinality(merchant_ids)>0 and owner_evidence_ref is not null))
);
-- No direct browser access even when Supabase has an authenticated session.
alter table public.mini_nines_tasks enable row level security;
alter table public.mini_nines_audit enable row level security;
alter table public.mini_nines_receipts enable row level security;
alter table public.mini_nines_outbox enable row level security;
alter table public.mini_nines_policies enable row level security;
revoke all on public.mini_nines_tasks,public.mini_nines_audit,public.mini_nines_receipts,public.mini_nines_outbox,public.mini_nines_policies from public,anon,authenticated;
grant select,insert,update on public.mini_nines_tasks,public.mini_nines_audit,public.mini_nines_receipts,public.mini_nines_outbox,public.mini_nines_policies to service_role;
revoke all on sequence public.mini_nines_audit_id_seq from public,anon,authenticated;
grant usage on sequence public.mini_nines_audit_id_seq to service_role;
-- Atomic optimistic transition with owner, expected state and version; append audit in same transaction.
create or replace function public.mini_nines_transition(p_owner text,p_task uuid,p_version integer,p_from text,p_to text,p_reason text,p_attempt integer,p_receipt text default null)
returns integer language plpgsql security invoker as $$
declare updated integer;
begin
 if p_owner is null or p_task is null or p_reason is null or char_length(p_reason) not between 1 and 500
    or p_attempt not between 0 and 3 then return 0; end if;
 if not ((p_from='PLANNED' and p_to in ('AUTH_SCOPED','FAILED'))
  or (p_from='AUTH_SCOPED' and p_to in ('CHARGING','FAILED'))
  or (p_from='CHARGING' and p_to in ('CHARGING','VERIFYING','FAILED','SETTLEMENT_UNKNOWN'))
  or (p_from='VERIFYING' and p_to in ('VERIFIED','FAILED','SETTLEMENT_UNKNOWN'))) then return 0; end if;
 if p_to='VERIFIED' and nullif(p_receipt,'') is null then return 0; end if;
 update public.mini_nines_tasks set state=p_to,version=version+1,attempts=p_attempt,updated_at=now()
 where id=p_task and user_email=p_owner and version=p_version and state=p_from
  and (p_to<>'VERIFIED' or exists(
   select 1 from public.mini_nines_receipts r where r.user_email=p_owner and r.task_id=p_task
     and r.gmail_message_id=p_receipt and r.match_status='MATCHED'));
 get diagnostics updated=row_count;
 if updated=1 then
  insert into public.mini_nines_audit(task_id,user_email,from_state,to_state,reason,attempt,receipt_message_id)
  values(p_task,p_owner,p_from,p_to,p_reason,p_attempt,p_receipt);
 end if;
 return updated;
end; $$;
revoke all on function public.mini_nines_transition(text,uuid,integer,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.mini_nines_transition(text,uuid,integer,text,text,text,integer,text) to service_role;
