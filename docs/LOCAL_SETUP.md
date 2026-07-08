# Local Setup

This project is configured to keep the browser extension talking to a local backend:

- Extension API base: `http://127.0.0.1:3000/api`
- Backend model provider: configured through environment variables
- Payment and CSV purchase modules: disabled by default with `ENABLE_PAYMENT=false`

## Environment

Use `.env.example` as the variable list. Do not put real API keys in source control.

Required local values:

```env
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=auto_comment

MODEL_API_BASE=https://www.packyapi.com/v1
MODEL_WIRE_API=responses
MODEL_CHAT_PATH=/responses
MODEL_NAME=gpt-5.5
MODEL_API_KEY=

ENABLE_PAYMENT=false
```

For an OpenAI-compatible chat-completions provider, use:

```env
MODEL_WIRE_API=chat_completions
MODEL_CHAT_PATH=/chat/completions
```

## Database

The project includes a Docker Compose MySQL service for local use. It binds only to `127.0.0.1`.

Start MySQL:

```powershell
npm run local:db:start
```

Create the local MySQL database and core tables:

```powershell
npm run local:db:setup
```

Or create the database, tables, and a local user in one command:

```powershell
npm run local:db:setup -- local-user-001 100
```

Use the same user ID in the extension options page.

If the database already exists and you only want to reset a user's points:

```powershell
npm run local:init-user -- local-user-001 100
```

Stop MySQL when you are done:

```powershell
npm run local:db:stop
```

## Run

```powershell
npm install
npm run local:stack:start
```

Quick checks:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod "http://127.0.0.1:3000/api/get-points?userId=local-user-001"
```

Load the extension from this project directory in Chrome after the backend is running.

## Auto Start On Windows

Chrome extensions cannot start Docker or local processes directly. Install the Windows logon task once so the local stack is already running when you open the browser:

```powershell
npm run local:autostart:install
```

Start it immediately without logging out:

```powershell
npm run local:stack:start
```

Disable auto start:

```powershell
npm run local:autostart:uninstall
```
