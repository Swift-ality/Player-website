# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Player Management Website for DeeHain SMP - A multi-user web application for managing Minecraft players with role-based access control (Admin and Streamer roles).

### Architecture

**Backend (server.js)**
- Express.js server with session-based authentication using bcryptjs
- File-based persistence using `data.json` (player data, selections, tags) and `users.json` (authentication)
- Two-tier role system: Admins (full control) and Streamers (player selection only)
- RESTful API with middleware for auth (`requireAuth`) and admin access (`requireAdmin`)

**Frontend**
- Vanilla JavaScript (no framework)
- Three main pages: `login.html`, `admin.html`, `dashboard.html` (streamer view)
- All pages in `public/` directory served as static files

**Data Structure**
- `data.json`: Contains `globalPlayers` (all players), `selections` (streamer picks indexed by username), and `globalTags`
- `users.json`: User credentials with bcrypt-hashed passwords
- Default admin account: username `admin`, password `admin123`

### Key Components

**Authentication Flow**
- POST `/api/login` - Username/password validation, creates session
- GET `/api/session` - Check current session state
- POST `/api/logout` - Destroy session

**Admin Capabilities**
- User management: Create/delete streamers, create admin accounts (main admin only)
- Global player CRUD operations with color and tag assignment
- Global tag management (create/delete tags applied to all players)
- View any streamer's player selections

**Streamer Capabilities**
- View all players with filtering by tags
- Toggle player selections (stored per username in `data.json`)
- Read-only access to global player pool

## Commands

### Start Server
```bash
npm start
```
Runs on port 3000 (or `$env:PORT` on Windows)

### Install Dependencies
```bash
npm install
```

### Deployment with PM2
```bash
pm2 start server.js --name player-website
pm2 save
pm2 startup
```

## Development Notes

### File Storage
Both `data.json` and `users.json` are auto-created on first run if missing. Data is written synchronously on every change.

### Security
- Session secret is hardcoded in `server.js` - should be changed for production
- Only the user with username `admin` can create additional admin accounts
- All admin routes require `requireAdmin` middleware

### HMCLeaves Subdirectory
Contains a separate Gradle-based Minecraft plugin project (unrelated to the web app) - uses Kotlin DSL build scripts.

### Public Directory Structure
- `login.html` / `login.js` - Authentication page
- `dashboard.html` / `dashboard.js` - Streamer interface
- `admin.html` / `admin.js` - Admin panel
- `styles.css` - Shared styles

### Testing
No test framework currently configured.
