# Build status, October 7

Reconstructed isolated engine. No production release or live charge/send/model call.

## Verified

- 92 automated tests passed, strict TypeScript typecheck passed.
- Durable offline PostgreSQL intake, complete-order review and lease/effect gates.
- All ten reviewed order fields plus connection/account version bound by the new SQL gate.
- Idempotent simulation ledger, safe-decline backoff and three-attempt circuit breaker.
- Unknown effects frozen for reconciliation; accepted payment is VERIFYING until evidence.
- Restart persistence, owner isolation, offline authenticated receipt watch cursor.
- Deadline recovery-window alert intents remain disabled, with no sent claims.
- Separate real x402 SDK path tested with throwaway un-funded keys and mocked HTTP.
- Real quote includes exact wallet, Base/native-USDC asset, recipient, endpoint, amount, expiry and no automatic refund terms.
- AI proposal module and optional real model connector exist; no real model call performed.

## Not yet release-ready

- Simulation and prepared real x402 path remain separate, not one production service.
- No hosted worker/HTTP app/consent UI deployed. Host/session middleware still needs wiring.
- RealStore is a trusted-server boundary; it cannot accept arbitrary agent/model approval objects. Original exact owner consent must be captured by the host.
- Real payment unknown-outcome reconciliation/retry and approval fencing require further tests, including stale host/session, deadlines during network calls and multi-session PostgreSQL races.
- Real settlement verifier needs live read-only integration proof and required confirmation/finality policy.
- Receipt parsing currently uses documented structured offline fixtures. Live merchant parsing and trusted gateway-header extraction remain unwired.
- No funding wallet, secure signer, model account, or enabled autonomy policy selected.
- No real alert sender connected. Delivery ledger only stores disabled intents.
- No exact first charge approved. Refresh merchant challenge before presenting any amount or recipient for confirmation.

## Candidate first charge, not approved

At October 7 16:36 GMT, unsigned GET https://api.onesource.io/api/chain/network-info returned x402 v2 exact scheme, Base eip155:8453, 1000 native USDC atomic units (0.001 USDC), payTo 0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea, USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. This is an observed challenge, not a spending grant or endorsement. A final fresh challenge and the owner's funding wallet/signer choice remain required. Transfer refund is merchant-dependent, not automatic.
