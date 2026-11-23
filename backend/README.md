# EdgeLab Backend

The EdgeLab backend is powered by **FastAPI** in [`app/`](app/) and provides REST endpoints, WebSocket streams, trade journaling, backtesting, analytics, and Pine Script execution services.

A companion Node.js service in [`auth/`](auth/) provides Better Auth session management.

---

## Getting Started

### Prerequisites
- Python 3.12+
- Node.js 22.13+ (for Better Auth)

### Setting Up Python Environment

From the repository root:

```bash
# 1. Create a virtual environment
python -m venv backend/.venv

# 2. Activate the virtual environment
# Windows (PowerShell):
.\backend\.venv\Scripts\Activate.ps1
# Linux / macOS:
source backend/.venv/bin/activate

# 3. Install dependencies
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt

# 4. Run database migrations
PYTHONPATH=backend alembic -c backend/alembic.ini upgrade head
```

### Running the API Server

```bash
# Start FastAPI backend directly with Uvicorn:
PYTHONPATH=backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The interactive OpenAPI documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

---

## Code Structure

| Path | Responsibility |
| --- | --- |
| [`app/main.py`](app/main.py) | ASGI application entrypoint, CORS, middleware, and lifecycle |
| [`app/api/routes.py`](app/api/routes.py) | REST and WebSocket route definitions |
| [`app/auth.py`](app/auth.py) | Session validation, identity verification, and token exchange |
| [`app/db.py`](app/db.py) | Database connection engine and session factory |
| [`app/market_data_db.py`](app/market_data_db.py) | Market candle database schema and connection management |
| [`app/models.py`](app/models.py) | SQLAlchemy ORM database models |
| [`app/schemas.py`](app/schemas.py) | Pydantic validation schemas for requests and responses |
| [`app/services/`](app/services/) | Domain services (backtester, journal, datasets, order flow, metrics) |
| [`alembic/`](alembic/) | Database migration scripts |
| [`auth/`](auth/) | Better Auth Node.js service |
| [`tests/`](tests/) | Pytest test suite |

---

## Running Tests

Run the backend test suite:

```bash
PYTHONPATH=backend pytest backend/tests
```
