"""Case review history, settings and knowledge."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "case_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("report", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_case_reviews_owner_id", "case_reviews", ["owner_id"])
    op.create_table("case_settings", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("config", sa.JSON(), nullable=False))
    op.create_table("case_knowledge", sa.Column("id", sa.Uuid(), primary_key=True),
                    sa.Column("filename", sa.String(255), nullable=False),
                    sa.Column("content", sa.Text(), nullable=False))


def downgrade():
    op.drop_table("case_knowledge")
    op.drop_table("case_settings")
    op.drop_table("case_reviews")
