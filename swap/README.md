# Curtain Swap

This is the beginner-facing swap frontend for `swap.curtainrh.com`.

Deploy it as a separate Vercel project with:

- Root Directory: `swap`
- Build Command: `npm run build`
- Output Directory: `dist`
- Custom domain: `swap.curtainrh.com`

The included `vercel.json` proxies `/api/curtain` and `/api/curtain-v3` to the existing operator service. No new backend or contract deployment is required.
