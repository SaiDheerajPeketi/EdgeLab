from __future__ import annotations

import json

from sqlalchemy import select

from app.db import SessionLocal
from app.models import BetaUser
from app.services.session_summaries import refresh_user_session_summaries


def main() -> None:
    touched = 0
    users = 0
    with SessionLocal() as db:
        user_ids = db.scalars(select(BetaUser.id)).all()
        users = len(user_ids)
        for user_id in user_ids:
            touched += refresh_user_session_summaries(db, user_id)
        db.commit()
    print(json.dumps({"users": users, "session_summaries_refreshed": touched}))


if __name__ == "__main__":
    main()
