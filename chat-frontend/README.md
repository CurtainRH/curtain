# Curtain Chat

Standalone natural-language swap interface for `chat.curtain.com`.

## MVP behavior

- Interprets a message on the operator server; the Groq credential never goes to the browser.
- Uses the existing operator `/quote`, `/config`, `/intents` and `/rpc` paths.
- Pins every proposal and execution to the Curtain V2 flexible-amount vault. No V3, Pool V2/product V4, or dynamic routing is exposed here.
- Shows the route in the assistant response and approval card before wallet approval.
- The user reviews and accepts/declines a proposal. Acceptance still requires wallet approval and deposit signatures; the model cannot sign or submit transactions.
- Saves the escape-ticket material in browser local storage as soon as the intent is created.

## Deployment

Create a separate Vercel project for this directory, set its Root Directory to `chat-frontend`, use the Bun install/build defaults, and attach `chat.curtain.com`. The included Vercel rewrites send API and RPC requests to the operator so the browser never calls the chain RPC directly.

The operator service needs `GROQ_API_KEY` and `GROQ_MODEL`. These are server-only Render variables. No Groq credential or operator URL needs to be added to the Chat frontend. If these variables are absent, the Chat interpretation endpoint returns 503 and normal operator swap routes remain unaffected.

For local development, run `bun install` and `bun run dev` from this directory. Requests are proxied to `operator.curtainrh.com`.
