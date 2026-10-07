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

## Prepared real x402 path

A separate official-SDK x402 adapter now prepares unsigned quotes for exact native USDC on Base, binds wallet/resource/recipient/amount/expiry/undo terms, atomically claims reviewed approval before signing, records one signed payload/submission, and checks on-chain Transfer evidence. It does not use automatic paid fetch or fallback networks/schemes. No real wallet, private key or charge has been connected. Tests use throwaway random test signers with mocked HTTP, never a funded wallet/network.

The real quote store and settlement verifier are implemented but not production-host wired. An application host must recover authenticated human consent to the complete final quote and supply the secure signer. An approval-shaped object from an AI model or chat body is not consent. Unknown signing/submission outcomes require reconciliation, not a new authorization. Mainnet retries/reconciliation remain a release gate before live use.

AI budget/deadline proposal validation and an optional model HTTP connector are implemented. Current scenarios use offline model outputs. No claim of live inference or autonomous spending. Model account choice and any usage costs need separate review.

Research sources: https://github.com/coinbase/x402/blob/main/typescript/packages/mechanisms/evm/README.md and https://docs.onesource.io/getting-started/x402-and-mpp/x402-base . An unsigned OneSource network-info request on October 7 returned a 0.001 USDC Base exact payment challenge. This observed price is not a standing approval and must be refreshed before a charge.
