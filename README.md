# Project Portal

Team project-management portal: projects, kanban tasks, quotes & budgets, documents, and team members with role-based logins.

- **Backend**: Node.js + Express + SQLite (better-sqlite3), JWT auth, file uploads
- **Frontend**: React + Vite (dark theme), served by the same Express server in production
- **Roles**: `admin` (full control incl. team management), `manager` (create/edit projects, tasks, quotes, documents), `viewer` (read-only)

## Run locally

```bash
npm install
npm run build     # builds the React client into client/dist
npm start         # serves app + API on http://localhost:3001
```

First login (auto-seeded when the database is empty):
- **Email**: `admin@portal.local`
- **Password**: `admin123` — change it immediately (or set `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before first start).

For frontend development with hot reload: run `npm start` in one terminal and `cd client && npm run dev` in another (Vite proxies `/api` to :3001).

## Deploy on Render

1. Push this `portal` folder to your GitHub repo.
2. Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Root Directory**: `portal` (or leave blank if the portal files are at the repo root)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Starter or higher — see the data warning below
4. Environment variables:
   - `JWT_SECRET` — click **Generate** (required; signs login tokens)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — credentials for the first admin account (only used on the very first boot)
   - `DATA_DIR` = `/data`
5. **Advanced → Add Disk**: mount path `/data`, 1 GB+. This is where the SQLite database and uploaded documents live.

> **⚠️ Data persistence**: Render's **Free** instances have no persistent disk — the database and all uploads are **wiped on every deploy or restart**. Use **Starter ($7/mo)** or higher and attach a disk mounted at `/data`. If the team grows, the clean upgrade path is swapping SQLite for Render's managed Postgres (the API layer is isolated in `server/routes.js` + `server/db.js`).

## Future mobile app

All functionality goes through the JSON REST API under `/api` with Bearer-token auth, so an iPhone/Android app (e.g. React Native) can reuse the backend as-is.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Dashboard | `GET /api/dashboard` |
| Users | `GET/POST /api/users`, `PUT /api/users/:id` (admin) |
| Projects | `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id` |
| Tasks | `POST /api/projects/:id/tasks`, `PUT/DELETE /api/tasks/:id` |
| Quotes | `POST /api/projects/:id/quotes`, `PUT/DELETE /api/quotes/:id` |
| Documents | `POST /api/projects/:id/documents` (multipart), `GET /api/documents/:id/download`, `DELETE /api/documents/:id` |
