# Curtain developer documentation frontend

This directory is a standalone Vite site, deployed separately at `docs.curtainrh.com`.
Existing Markdown product specifications and deployment documents remain here unchanged.
Only `index.html`, its referenced `src/` assets, and `public/` are published in `dist/`.

## Local development

```sh
npm ci --prefix docs
npm run dev --prefix docs
npm run build --prefix docs
```

## Vercel

Create a separate project using the private repo, branch `main`:

- Root Directory: `docs`
- Framework: Vite
- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- Domain: `docs.curtainrh.com`

No environment variables or API keys are needed for this static documentation site.
It does not make authenticated API calls or offer a browser API-key playground.

## Developer API deployment

The existing operator serves `/developer/*` for wallet-signature key management and
`/v1/*` for authenticated V2 integration. `005_developer_api.sql` is applied by the
operator's existing startup migration. Keys and developer intents use the V2 database.
No new operator, keeper, or main frontend environment variables are required.
Deploy the backend before the main dashboard. The keeper and vault contracts are unchanged.

Dashboard management uses the existing same-origin `/api/curtain/developer/*` proxy.
Third-party backends call `https://operator.curtainrh.com/v1` with a Bearer API key.
V3, stealth/split parameters, and smart-contract wallet authentication are not supported
by this first developer release. Key-specific limits persist in PostgreSQL across restarts.

Security checks: `cd backend && bun test services/operator/test/developer.test.ts`.
