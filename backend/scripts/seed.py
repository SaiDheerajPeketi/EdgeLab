from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import Playbook


SEED_PLAYBOOKS = [
    {
        "name": "Breakout Continuation",
        "description": "Trend-continuation setup after a range or session high/low break.",
        "rules": "Define range, wait for close through level, avoid late entries after extended candles.",
    },
    {
        "name": "Mean Reversion",
        "description": "Counter-move setup around stretched price action and clear invalidation.",
        "rules": "Require exhaustion, define nearby target, keep stop beyond the failed extreme.",
    },
    {
        "name": "News Stand Aside",
        "description": "Risk-control checklist for high-impact calendar windows.",
        "rules": "Avoid fresh discretionary trades before impact events unless the session plan explicitly allows them.",
    },
]


def main() -> None:
    init_db()
    created = 0
    with SessionLocal() as db:
        for payload in SEED_PLAYBOOKS:
            existing = db.scalar(
                select(Playbook).where(Playbook.name == payload["name"])
            )
            if existing is not None:
                continue
            db.add(Playbook(**payload))
            created += 1
        db.commit()
    print(f"Seed complete: {created} playbooks created")


if __name__ == "__main__":
    main()
