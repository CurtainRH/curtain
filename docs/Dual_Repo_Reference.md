# Dual-Repository Multi-Remote Synchronization Guide

This document outlines the workflow and architecture for synchronizing the Curtain codebase between the **Private Production Repo** (`NotADeveloper7/curtain`) and the **Public Open-Source Repo** (`CurtainRH/curtain`).

---

## 1. Architecture Overview

| Property | Private Production Repo | Public Open-Source Repo |
| :--- | :--- | :--- |
| **GitHub URI** | `NotADeveloper7/curtain` | `CurtainRH/curtain` |
| **Git Remote** | `origin` | `origin-public` |
| **Branch** | `main` | `main` |
| **Author Name** | `NAD7` | `CurtainRH` |
| **Author Email** | `notadeveloper7@outlook.com` | `curtainsrh@atomicmail.io` |
| **Integrations** | Vercel (Frontend), Lovable | Render (Backend), Public GHA (Infinite Free Minutes), Open Source |

---

## 2. Fast Commands

From the project root:

### A. Push to Production Only
Pushes your local `main` branch directly to the private repo (`NotADeveloper7/curtain`):
```bash
bun run push:origin
# or: git push origin main
```

### B. Push to Public Open-Source Repo Only
Automatically rewrites all commit authors and committers to `CurtainRH <curtainsrh@atomicmail.io>` and pushes to `origin-public/main`:
```bash
bun run push:public
# or: python3 scripts/sync-public.py
```

### C. Push to Both Repos Simultaneously
Pushes to production first, then triggers the public author-sanitizing sync:
```bash
bun run push:all
```

---

## 3. How the Public Sync Engine Works

The sync script is located at [`scripts/sync-public.py`](../scripts/sync-public.py).

### Under the Hood:
1. **`git fast-export main`**: Streams the entire commit tree, preserves exact commit timestamps, commit messages, and tree hashes.
2. **Byte-Exact Stream Rewriter**:
   - Replaces `author ...` with `author CurtainRH <curtainsrh@atomicmail.io> <timestamp> <tz>`
   - Replaces `committer ...` with `committer CurtainRH <curtainsrh@atomicmail.io> <timestamp> <tz>`
   - Replaces `tagger ...` with `tagger CurtainRH <curtainsrh@atomicmail.io> <timestamp> <tz>`
   - Preserves all binary blobs (images, fonts, WASM, icons) without character corruption.
   - Redirects target ref from `refs/heads/main` to `refs/heads/public-main`.
3. **`git fast-import`**: Generates a clean local branch `public-main`.
4. **`git push origin-public public-main:main --force`**: Publishes the clean history to the public repo.
5. **Zero Disruption to Vercel/Lovable**: Your local `main` branch and `origin/main` remain 100% intact with original commit hashes so deployment sync is never broken.

---

## 4. Verifying Remotes & Credentials

To check your remote URLs:
```bash
git remote -v
```

Expected output:
```text
origin          https://ghp_...github.com/NotADeveloper7/curtain.git (fetch)
origin          https://ghp_...github.com/NotADeveloper7/curtain.git (push)
origin-public   https://ghp_...github.com/CurtainRH/curtain.git (fetch)
origin-public   https://ghp_...github.com/CurtainRH/curtain.git (push)
```

To verify commit authorship on the public branch:
```bash
git log -n 5 --format="%h %an <%ae> %s" public-main
```
