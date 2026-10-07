# Agent scenarios

1. Budget agent proposes paid chain information before a deadline. The proposal is validated against budget, currency and deadline. The exact x402 quote then waits for the human's wallet/recipient/amount approval. A model can never approve its own task.
2. Deadline agent requests an input needed for a report before its due time. The worker watches the recovery window, not merely the final deadline. Missing merchant confirmation creates SETTLEMENT_UNKNOWN and disabled recovery intents.

The current test scenarios inject offline model output and local session principals. They test the proposal-to-engine boundary, not a claim of live AI inference. `OpenAICompatiblePlanner` is a real HTTP model connector, but no model key/account has been connected and no paid model call has occurred. The model must receive verified merchant quotes and terms as context from the host before it can make a valid proposal; missing context fails closed.

The simulation worker and real x402 adapter are distinct. The real adapter currently lacks production host wiring, a secure owner wallet signer and a deployment approval. All live spends and sends remain blocked.
