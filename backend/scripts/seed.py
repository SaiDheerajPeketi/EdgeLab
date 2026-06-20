from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import BetaUser
from app.services.default_playbooks import ensure_default_playbooks


def main() -> None:
    init_db()
    created = 0
    with SessionLocal() as db:
        users = db.scalars(select(BetaUser).order_by(BetaUser.id.asc())).all()
        for user in users:
            created += ensure_default_playbooks(db, user.id)
        db.commit()
    print(f"Seed complete: {created} playbooks created across {len(users)} users")


if __name__ == "__main__":
    main()
