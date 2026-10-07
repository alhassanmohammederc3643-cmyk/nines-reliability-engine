# Nines reliability engine

Reconstructed isolated development build, October 7, 2026. This is not the lost September 30 archive and is not deployed to MINI.

Money and deadline tasks must never be reported complete until matching authenticated settlement evidence exists. States: PLANNED, AUTH_SCOPED, CHARGING, VERIFYING, VERIFIED, FAILED, SETTLEMENT_UNKNOWN.

## Safety boundary

Only simulated charging and offline alert intents are permitted in this build. No real merchant/payment/sending adapter is connected. Autonomy policies remain disabled. Authenticated owner review binds the entire order, connection and target version. Ambiguous effects are never blindly retried. Deployment, real charging and communication each require separate owner approval.

## Reconstruction

Authored core, parsing, lease/review source and historical SQL were recovered as source text, not recreated from recollection. The old 97-test count included the wider MINI app; this standalone suite reports its own count. Historical SQL is retained for lineage and must not be mistaken for a release-ready migration. Full-order binding and durable worker development follow in new modules and migrations.

Run `npm install`, `npm test`, `npm run build`. No secrets belong in this repository.

## October 7 working paths

The new engine has durable authenticated-host task intake, exact proposal review, a database-level full-order/connection/version gate, owner-scoped worker ticks, simulated idempotent payment ledger, safe-decline backoff/circuit breaker, crash/unknown reconciliation, offline authenticated receipt-source cursor handling, and deadline-aware disabled alert intents. PostgreSQL and TypeScript use the same length-prefixed UTF-8 hash representation. This new isolated schema does not upgrade or apply the historical production tables.

The session verifier is a required host integration, not a chat-authorship guess. Tests inject fixed offline principals. Receipt verification supports structured fixtures, not arbitrary live merchant formats. Gateway authentication evidence must be supplied by a real trusted mail integration before live receipt access can be enabled. User, account and merchant-address bindings are host responsibilities.

Remaining release gates: independent multi-session PostgreSQL concurrency/load checks, production host/session wiring and reviewed consent UI, merchant-specific receipt parser and trusted gateway header validation, real provider selection and scope enforcement, deployment/migration/rollback review, real alert permission and delivery receipts, separately approved payment authority. No hosted worker or live watch exists. Local offline worker ticks are implemented and tested.
