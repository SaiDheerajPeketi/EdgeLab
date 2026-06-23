from app.db import SessionLocal, init_db


def main() -> None:
    init_db()
    with SessionLocal() as db:
        db.commit()
    print("Seed complete: no default user data is provisioned.")


if __name__ == "__main__":
    main()
