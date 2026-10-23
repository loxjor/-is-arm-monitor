"""department head

Revision ID: 3aa18ca7867a
Revises: edb510e512ff
Create Date: 2026-10-23 14:50:00.000000

Руководитель подразделения (для профиля сотрудника) — сверх Т-модели
курсового. batch_alter_table: SQLite не умеет ALTER TABLE ADD CONSTRAINT,
для PostgreSQL batch выполняется обычными ALTER.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3aa18ca7867a'
down_revision: Union[str, None] = 'edb510e512ff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('department') as batch:
        batch.add_column(sa.Column('head_employee_id', sa.Integer(), nullable=True))
        batch.create_foreign_key(
            'fk_department_head_employee_id', 'employee', ['head_employee_id'], ['employee_id']
        )


def downgrade() -> None:
    with op.batch_alter_table('department') as batch:
        batch.drop_constraint('fk_department_head_employee_id', type_='foreignkey')
        batch.drop_column('head_employee_id')
