# GPTplugins

Chrome/Edge extension for highlighting, annotating, bookmarking, and asking about selected text on ChatGPT pages.

## Project Structure

- `apps/extension`: Chrome Manifest V3 extension built with React, Vite, and TypeScript.
- `apps/api`: FastAPI API with SQLAlchemy, Alembic, JWT auth, and email login codes.

## Local Development

### Extension

```bash
npm install
npm run build:extension
```

Then open `chrome://extensions`, enable Developer mode, and load:

```text
apps/extension/dist
```

Reload the extension after every build, then refresh ChatGPT.

### API

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

The extension defaults to `http://127.0.0.1:8000`.

## Environment

Copy `.env.example` to `.env` for local API development.

For production, set the same variables in Vercel and point the extension build config to the deployed API URL.

## Privacy

The backend stores only selected highlight text, annotation text, and anchoring metadata. The full ChatGPT conversation is not stored. Ask prompts are generated locally in the browser and copied to the clipboard.

## Checks

```bash
npm run test:extension
npm run build:extension
cd apps/api && pytest
```
