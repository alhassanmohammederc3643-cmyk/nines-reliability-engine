# Nines reliability engine

Reconstructed isolated development build, October 7, 2026. This is not the lost September 30 archive and is not deployed to MINI.

Money and deadline tasks must never be reported complete until matching authenticated settlement evidence exists. States: PLANNED, AUTH_SCOPED, CHARGING, VERIFYING, VERIFIED, FAILED, SETTLEMENT_UNKNOWN.

## Safety boundary

Only simulated charging and offline alert intents are permitted in this build. No real merchant/payment/sending adapter is connected. Autonomy policies remain disabled. Authenticated owner review binds the entire order, connection and target version. Ambiguous effects are never blindly retried. Deployment, real charging and communication each require separate owner approval.

## Reconstruction

Authored core, parsing, lease/review source and historical SQL were recovered as source text, not recreated from recollection. The old 97-test count included the wider MINI app; this standalone suite reports its own count. Historical SQL is retained for lineage and must not be mistaken for a release-ready migration. Full-order binding and durable worker development follow in new modules and migrations.

Run `npm install`, `npm test`, `npm run build`. No secrets belong in this repository.
