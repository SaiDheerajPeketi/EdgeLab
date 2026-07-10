# EdgeLab Frontend

## Overview
The EdgeLab frontend is a single-page application (SPA) built with React and Vite. It serves as the primary user interface for traders, offering features like manual bar replay, risk sizing, trade journaling, session analytics, and visual market data rendering.

## Responsibilities
- **Authentication**: Handles Google OAuth beta sign-in flows and session management.
- **Market Data Visualization**: Renders interactive candlestick charts and technical drawings using `lightweight-charts` and `@visx`.
- **Replay State**: Maintains local simulation state (orders, open positions, equity, current candle) and synchronizes with the backend.
- **Journaling**: Provides forms and views to review historical trades, strategies, and session outcomes.
- **Routing**: Client-side routing for public marketing/pricing surfaces and the protected `/app` workspace.

## Architecture / How it fits into the system
The frontend communicates entirely with the FastAPI backend over REST APIs and WebSockets.
- In production, it is statically built into `frontend/dist` and served by Nginx.
- Nginx proxies all `/api/*` calls from the SPA to the backend, mitigating CORS complexities in production.
- Global client state is managed by `zustand`.

## Directory Structure (brief)
- `/public/` - Static assets, uncompiled files, and vendor assets.
- `/src/`
  - `/components/` - Reusable UI components (buttons, charts, dialogs).
  - `/lib/` - Shared utilities, hooks, and API client wrappers.
  - `/pages/` - Top-level page views (e.g., Marketing, Sign-in, Workspace).
  - `/routes/` - React Router definitions.
  - `/store/` - Zustand global state stores (backtest, playback, auth).
  - `styles.css` - Global Tailwind CSS definitions.
  - `main.tsx` - Application entry point.
- `package.json` - Node dependencies and scripts.
- `vite.config.ts` - Vite build, proxy, and chunking configuration.

## Configuration
> ⚠️ Note: For Docker builds, these are passed as build arguments in `docker-compose.yml`.

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Base path for backend API requests | `/api` |
| `VITE_API_BEARER_TOKEN` | Hardcoded bearer token for restricted routes (if needed) | `""` |
| `VITE_DEPLOYMENT_MODE` | Controls UI layout (e.g., `beta` vs `public`) | `beta` |
| `VITE_BETA_SEATS_TOTAL`| Display total available beta seats | `500` |
| `VITE_BETA_SEATS_TAKEN`| Display currently taken beta seats | `0` |

## Dependencies
- **React (`react`, `react-dom`)**: UI library.
- **Vite (`vite`, `@vitejs/plugin-react`)**: Build tool and dev server.
- **React Router (`react-router-dom`)**: Client-side routing.
- **Zustand (`zustand`)**: Global state management.
- **Tailwind CSS (`tailwindcss`, `autoprefixer`, `postcss`)**: Utility-first styling.
- **Lightweight Charts (`lightweight-charts`)**: High-performance financial charts.
- **Visx (`@visx/*`)**: Low-level visualization primitives (heatmaps, curves, etc.).
- **Framer Motion (`motion`)**: Fluid UI animations.
- **Base UI (`@base-ui/react`)**: Unstyled headless accessible UI components.
- **Lucide (`lucide-react`)**: SVG icons.

## Local Development
Install dependencies:
```bash
npm install
```

Start the Vite development server:
```bash
npm run dev
```
> This will start the server on `http://127.0.0.1:5173`. The Vite config automatically proxies `/api` calls to `http://127.0.0.1:8000`.

Build for production:
```bash
npm run build
```

Preview production build:
```bash
npm run preview
```
