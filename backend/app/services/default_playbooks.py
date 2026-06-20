from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Playbook


DEFAULT_PLAYBOOKS = [
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


def ensure_default_playbooks(db: Session, user_id: int) -> int:
    existing_names = set(
        db.scalars(
            select(Playbook.name).where(Playbook.user_id == user_id)
        ).all()
    )
    created = 0
    for payload in DEFAULT_PLAYBOOKS:
        if payload["name"] in existing_names:
            continue
        db.add(Playbook(user_id=user_id, **payload))
        created += 1
    if created:
        db.flush()
    return created
