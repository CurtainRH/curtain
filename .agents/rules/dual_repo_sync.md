# Dual-Repository Synchronization & Workflow Rules

When working on or modifying this codebase, follow these rules:

1. **Git Remote Configuration**:
   - `origin`: `https://github.com/notadeveloper7/curtain.git` (Private Production Repo)
   - `origin-public`: `https://github.com/CurtainRH/curtain.git` (Public Open-Source Repo)

2. **Credentials**:
   - Credentials and Personal Access Tokens are documented in `docs/Curtain_Git.md`.

3. **Push & Sync Workflow**:
   - Private Production Push: `bun run push:origin` (`git push origin main`)
   - Public Sync & Push: `bun run push:public` (`python scripts/sync-public.py`)
   - Dual Sync: `bun run push:all` (`git push origin main && python scripts/sync-public.py`)

4. **Author Identity Integrity**:
   - Never push directly to `origin-public` without passing through `python scripts/sync-public.py`.
   - The sync script streams fast-export -> byte rewrite -> fast-import to ensure all public commit identities are mapped to `CurtainRH <curtainsrh@atomicmail.io>`.

5. **Monorepo Directory Structure**:
   - Frontend files reside at the repo root.
   - All backend contracts, services, and packages reside under `backend/`.
   - Do NOT create or leave behind legacy top-level folders like `/contracts`, `/circuits`, `/apps`, `/packages`, `/services`, or `.tools`.
   - Never delete or modify files in `/docs` unless explicitly requested.
