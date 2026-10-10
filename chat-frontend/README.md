# Curtain Chat

Standalone natural-language swap interface for `chat.curtain.com`.

## MVP behavior

- Interprets a message on the operator server; the Groq credential never goes to the browser.
- Uses the existing operator `/quote`, `/config`, `/intents` and `/rpc` paths.
- Uses Dynamic Privacy for each proposal: it tries Curtain V4’s shielded-pool route first when an immediate quote is available, then Curtain V3 for a configured fixed denomination, and Curtain V2 for flexible amounts.
- Shows the selected route in the assistant response and approval card before wallet approval.
- If Curtain V4 fails before the shielded swap is submitted, it requotes through V3/V2. If a shielded transaction may already have happened, it does not retry through another route; its local recovery note is retained.
- The user reviews and accepts/declines a proposal. Acceptance still requires wallet approval and deposit signatures; the model cannot sign or submit transactions.
- Saves V2/V3 escape-ticket material or the V4 recovery note in browser local storage before the corresponding wallet transaction.

## Deployment

Create a separate Vercel project for this directory, set its Root Directory to `chat-frontend`, use the Bun install/build defaults, and attach `chat.curtain.com`. The included Vercel rewrites send API and RPC requests to the operator so the browser never calls the chain RPC directly.

The operator service needs `GROQ_API_KEY` and `GROQ_MODEL`. These are server-only Render variables. No Groq credential or operator URL needs to be added to the Chat frontend. If these variables are absent, the Chat interpretation endpoint returns 503 and normal operator swap routes remain unaffected.

For local development, run `bun install` and `bun run dev` from this directory. Requests are proxied to `operator.curtainrh.com`.
