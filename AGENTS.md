## Project structure

- The Curtain site lives in `src/curtain/` and keeps its own history-based in-page router; route files under `src/routes/` (`/`, `/app`, `/app/$`, `/legal/$type`) mount it through `src/components/CurtainApp.tsx`, so deep links work while the original experience stays intact.
- `CurtainApp` renders client-only (lazy + `ClientOnly`) because the experience uses window, audio, GSAP and wallet APIs at mount.
- Curtain artwork, films and fonts are CDN assets: pointers in `src/assets/curtain/*.asset.json`, referenced by URL from the curtain CSS/TSX, keeping ~30 MB of media out of the repo.

## Monorepo layout

- Frontend (this project) stays at the repo root. Don't move it, because Vercel builds from here.
- `backend/` is a separate Bun workspace (contracts, packages, services) with its own `package.json` and `bun.lock`. Root lint and tsconfig ignore it.
- `docs/` holds the product specs; `docs/CURTAIN_V2_SPEC.md` is the current design. `docs/DUAL_REPO_SYNC.md` & `docs/Dual_Repo_Reference.md` explain the private/public repo sync (`scripts/sync-public.py`).

## Dual-Repository Sync Rules

- **Remotes**:
  - `origin`: Private Production Repo (`https://github.com/notadeveloper7/curtain.git`)
  - `origin-public`: Public Open-Source Repo (`https://github.com/CurtainRH/curtain.git`)
- **Credentials**: Use PAT tokens documented in `docs/Curtain_Git.md` (`NAD7` for `origin`, `CurtainRH` for `origin-public`).
- **Push Workflow**:
  - Always push private changes to `origin/main` using `bun run push:origin` (or `git push origin main`).
  - Always sanitize and synchronize to public open-source repo using `bun run push:public` (or `python scripts/sync-public.py`).
  - Or trigger both simultaneously using `bun run push:all`.
- **Author Identity Sanitization**: Never push directly to `origin-public` without using `scripts/sync-public.py`. The sync script ensures commit authorship on `origin-public` is deterministically rewritten to `CurtainRH <curtainsrh@atomicmail.io>`.
- **Workspace Hygiene**: Keep all backend services/packages/contracts inside `backend/`. Do not re-create legacy top-level folders (`/contracts`, `/circuits`, `/apps`, `/packages`, `/services`, `.tools`). Preserve all files in `/docs`.
