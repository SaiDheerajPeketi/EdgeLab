"""Bind verified Google accounts to stable provider subjects."""
from alembic import op
import sqlalchemy as sa

revision = "20261007_0017"
down_revision = "20261007_0016"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("beta_users") as batch:
        batch.add_column(sa.Column("google_subject", sa.String(255), nullable=True))
        batch.create_unique_constraint("uq_beta_users_google_subject", ["google_subject"])


def downgrade():
    with op.batch_alter_table("beta_users") as batch:
        batch.drop_constraint("uq_beta_users_google_subject", type_="unique")
        batch.drop_column("google_subject")
