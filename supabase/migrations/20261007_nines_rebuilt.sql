-- Isolated rebuild schema. Never applied to production. Simulation only.
create schema if not exists nines;
create function nines.valid_order(o jsonb) returns boolean language plpgsql immutable as $$
declare k text; keys text[]:=array['merchantId','orderId','itemSummary','amountMinor','currency','deliveryAddress','pickupAt','deadline','cancellationTerms','undoCostMinor'];
begin
 if o is null or jsonb_typeof(o)<>'object' or (select count(*) from jsonb_object_keys(o))<>10 or not(o ?& keys) then return false; end if;
 foreach k in array array['merchantId','orderId','itemSummary','currency','deliveryAddress','pickupAt','deadline','cancellationTerms'] loop
  if jsonb_typeof(o->k)<>'string' or length(btrim(o->>k))=0 then return false; end if;
 end loop;
 if o->>'currency' !~ '^[A-Z]{3}$' or jsonb_typeof(o->'amountMinor')<>'number' or jsonb_typeof(o->'undoCostMinor')<>'number'
 or o->>'amountMinor' !~ '^[0-9]+$' or o->>'undoCostMinor' !~ '^[0-9]+$' then return false; end if;
 if (o->>'amountMinor')::numeric not between 1 and 9007199254740991 or (o->>'undoCostMinor')::numeric not between 0 and 9007199254740991 then return false; end if;
 if o->>'pickupAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' or o->>'deadline' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' then return false; end if;
 perform (o->>'pickupAt')::timestamptz,(o->>'deadline')::timestamptz;
 return true;
exception when others then return false; end $$;
create function nines.review_hash(owner text,o jsonb,connection text,target text) returns text language plpgsql immutable as $$
declare v text; buffer text:=''; vals text[];
begin
 if not nines.valid_order(o) or owner is null or connection is null or target is null then return null; end if;
 vals:=array[owner,connection,target,o->>'merchantId',o->>'orderId',o->>'itemSummary',o->>'amountMinor',o->>'currency',o->>'deliveryAddress',o->>'pickupAt',o->>'deadline',o->>'cancellationTerms',o->>'undoCostMinor'];
 foreach v in array vals loop buffer:=buffer||octet_length(v)::text||':'||v; end loop;
 return encode(sha256(convert_to(buffer,'UTF8')),'hex');
end $$;
create table nines.tasks(
 id uuid primary key,owner text not null check(length(btrim(owner))>0),request_key text not null,
 final_order jsonb not null check(nines.valid_order(final_order)),connection_id text not null,target_version text not null,
 state text not null default 'PLANNED' check(state in ('PLANNED','AUTH_SCOPED','CHARGING','VERIFYING','VERIFIED','FAILED','SETTLEMENT_UNKNOWN')),
 version integer not null default 1,idempotency_key text not null unique,attempts integer not null default 0 check(attempts between 0 and 3),
 next_retry_at timestamptz,lease_id uuid,lease_until timestamptz,effect_started_at timestamptz,reconciliation_required boolean not null default false,
 scope jsonb,provider_result jsonb,receipt_id text,verify_by timestamptz,alert_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner,request_key),unique(owner,id)
);
create table nines.reviews(id uuid primary key,owner text not null,task_id uuid not null,final_order jsonb not null,
 connection_id text not null,target_version text not null,proposal_hash text not null,status text not null default 'awaiting_review' check(status in ('awaiting_review','approved','denied','expired')),
 expires_at timestamptz not null,evidence_ref text,decided_at timestamptz,consumed_at timestamptz,
 foreign key(owner,task_id) references nines.tasks(owner,id));
create table nines.audit(id bigint generated always as identity primary key,owner text not null,task_id uuid not null,event text not null,details jsonb not null default '{}',at timestamptz not null default now(),foreign key(owner,task_id) references nines.tasks(owner,id));
create table nines.receipts(owner text not null,task_id uuid not null,message_id text not null,source text not null,provider_account text not null,fields jsonb not null,auth_evidence jsonb not null,at timestamptz not null default now(),primary key(owner,message_id),foreign key(owner,task_id) references nines.tasks(owner,id));
create table nines.outbox(id text primary key,owner text not null,task_id uuid not null,channel text not null,payload jsonb not null,status text not null default 'disabled' check(status in ('disabled','pending','sending','confirmed','failed','unknown')),provider_reference text,foreign key(owner,task_id) references nines.tasks(owner,id));
create table nines.watch_cursors(owner text not null,connection_id text not null,cursor text,primary key(owner,connection_id));
create table nines.policies(owner text primary key,enabled boolean not null default false check(not enabled));
create function nines.enqueue_alert(p_owner text,p_task uuid,p_error text) returns void language plpgsql as $$
declare t nines.tasks; remaining integer;
begin
 select * into strict t from nines.tasks where owner=p_owner and id=p_task;
 remaining:=greatest(0,floor(extract(epoch from ((t.final_order->>'deadline')::timestamptz-clock_timestamp()))/60)::integer);
 insert into nines.outbox(id,owner,task_id,channel,payload)
 select t.id::text||':'||t.version::text||':'||channel,p_owner,p_task,channel,
 jsonb_build_object('error',left(p_error,500),'minutesLeft',remaining,'options',jsonb_build_array('Check the merchant status before any retry','Contact the merchant or choose a separately approved alternative'),'delivery','disabled')
 from unnest(array['push','sms','in_chat']) channel on conflict do nothing;
 insert into nines.audit(owner,task_id,event,details) values(p_owner,p_task,'ALERT_INTENT',jsonb_build_object('error',left(p_error,500),'minutesLeft',remaining));
end $$;
-- All effect gates lock the task first, then the review. No path bypasses complete order/account/version equality.
create function nines.decide(p_owner text,p_task uuid,p_review uuid,p_hash text,p_connection text,p_target text,p_decision text,p_evidence text) returns integer language plpgsql as $$
declare t nines.tasks; r nines.reviews;
begin
 if p_decision is null or p_decision not in ('approved','denied') or nullif(btrim(p_evidence),'') is null then return 0; end if;
 select * into t from nines.tasks where owner=p_owner and id=p_task for update;
 if not found or t.state<>'PLANNED' then return 0; end if;
 select * into r from nines.reviews where owner=p_owner and task_id=p_task and id=p_review for update;
 if not found or r.status<>'awaiting_review' or r.expires_at<=clock_timestamp() or r.final_order<>t.final_order
 or r.connection_id is distinct from p_connection or r.target_version is distinct from p_target
 or t.connection_id is distinct from p_connection or t.target_version is distinct from p_target
 or r.proposal_hash is distinct from p_hash or p_hash is distinct from nines.review_hash(p_owner,t.final_order,p_connection,p_target)
 or (t.final_order->>'pickupAt')::timestamptz<=clock_timestamp() or (t.final_order->>'deadline')::timestamptz<=clock_timestamp() then return 0; end if;
 update nines.reviews set status=p_decision,evidence_ref=p_evidence,decided_at=clock_timestamp() where id=p_review;
 if p_decision='denied' then update nines.tasks set state='FAILED',version=version+1 where id=p_task; end if;
 insert into nines.audit(owner,task_id,event,details) values(p_owner,p_task,'REVIEW_'||upper(p_decision),jsonb_build_object('review',p_review,'hash',p_hash,'evidence',p_evidence));
 return 1;
end $$;
create function nines.claim(p_owner text,p_task uuid,p_version integer,p_lease uuid,p_seconds integer) returns integer language plpgsql as $$
declare changed integer;
begin
 if p_lease is null or p_seconds is null or p_seconds not between 10 and 300 then return 0; end if;
 update nines.tasks set lease_id=p_lease,lease_until=clock_timestamp()+make_interval(secs=>p_seconds),version=version+1
 where owner=p_owner and id=p_task and version=p_version and state in ('PLANNED','AUTH_SCOPED')
 and effect_started_at is null and not reconciliation_required and (lease_until is null or lease_until<clock_timestamp())
 and (final_order->>'deadline')::timestamptz>clock_timestamp();
 get diagnostics changed=row_count;return changed;
end $$;
create function nines.begin_simulated_effect(p_owner text,p_task uuid,p_version integer,p_lease uuid,p_review uuid,p_hash text,p_connection text,p_target text,p_scope jsonb) returns integer language plpgsql as $$
declare t nines.tasks; r nines.reviews;
begin
 select * into t from nines.tasks where owner=p_owner and id=p_task for update;
 if not found or t.version is distinct from p_version or t.lease_id is distinct from p_lease or t.lease_until is null or t.lease_until<=clock_timestamp()
 or t.state<>'AUTH_SCOPED' or t.effect_started_at is not null or t.reconciliation_required or t.attempts<>0 then return 0; end if;
 select * into r from nines.reviews where id=p_review and owner=p_owner and task_id=p_task for update;
 if not found or r.status<>'approved' or nullif(r.evidence_ref,'') is null or r.consumed_at is not null or r.expires_at<=clock_timestamp()
 or r.final_order<>t.final_order or r.connection_id is distinct from t.connection_id or r.target_version is distinct from t.target_version
 or t.connection_id is distinct from p_connection or t.target_version is distinct from p_target
 or r.proposal_hash is distinct from p_hash or p_hash is distinct from nines.review_hash(p_owner,t.final_order,p_connection,p_target)
 or (t.final_order->>'pickupAt')::timestamptz<=clock_timestamp() or (t.final_order->>'deadline')::timestamptz<=clock_timestamp() then return 0; end if;
 if p_scope is null or jsonb_typeof(p_scope)<>'object' or not(p_scope ?& array['mode','merchantId','currency','amountMinor','reference','expiresAt']) or p_scope->>'mode' is distinct from 'SIMULATED' or p_scope->>'merchantId' is distinct from t.final_order->>'merchantId'
 or p_scope->>'currency' is distinct from t.final_order->>'currency' or p_scope->>'amountMinor' is distinct from t.final_order->>'amountMinor'
 or coalesce(p_scope->>'reference','') !~ '^sim_[a-f0-9]{32}$' or nullif(p_scope->>'expiresAt','') is null or (p_scope->>'expiresAt')::timestamptz<=clock_timestamp()
 or (p_scope->>'expiresAt')::timestamptz>clock_timestamp()+interval '2 hours' then return 0; end if;
 update nines.reviews set consumed_at=clock_timestamp() where id=p_review;
 update nines.tasks set state='CHARGING',scope=p_scope,effect_started_at=clock_timestamp(),reconciliation_required=true,attempts=1,version=version+1,updated_at=clock_timestamp() where id=p_task;
 insert into nines.audit(owner,task_id,event,details) values(p_owner,p_task,'SIMULATED_EFFECT_STARTED',jsonb_build_object('review',p_review,'idempotencyKey',t.idempotency_key));
 return 1;
exception when invalid_text_representation or datetime_field_overflow then return 0;
end $$;
-- Direct client access denied; only a trusted authenticated application may pass owner parameters.
do $$ declare tab text; begin
 foreach tab in array array['tasks','reviews','audit','receipts','outbox','watch_cursors','policies'] loop
 execute format('alter table nines.%I enable row level security',tab);
 end loop;
end $$;
revoke all on schema nines from public;
revoke all on all tables in schema nines from public;
revoke all on all functions in schema nines from public;
-- Prepared real x402 quotes. This does not enable real engine execution.
create table nines.x402_quotes(id uuid primary key,owner text not null,task_id text not null,quote jsonb not null,hash text not null,
 state text not null default 'PLANNED' check(state in ('PLANNED','CHARGING','VERIFYING','VERIFIED','SETTLEMENT_UNKNOWN')),
 approval jsonb,signed_payload jsonb,submitted_at timestamptz,outcome jsonb,created_at timestamptz not null default now(),unique(owner,id));
alter table nines.x402_quotes enable row level security;
revoke all on nines.x402_quotes from public;
