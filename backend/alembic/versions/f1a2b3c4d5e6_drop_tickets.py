"""drop tickets

Revision ID: f1a2b3c4d5e6
Revises: d2f7a9c3e5b1
Create Date: 2026-10-29 14:00:00.000000

Убираем функционал заявок: таблицы ticket и ticket_work больше не нужны.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'd2f7a9c3e5b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_ticket_work_user_id'), table_name='ticket_work')
    op.drop_table('ticket_work')
    op.drop_index(op.f('ix_ticket_requester_id'), table_name='ticket')
    op.drop_index(op.f('ix_ticket_equipment_id'), table_name='ticket')
    op.drop_index(op.f('ix_ticket_assignee_id'), table_name='ticket')
    op.drop_table('ticket')


def downgrade() -> None:
    op.create_table('ticket',
    sa.Column('ticket_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('ticket_type', sa.Enum('install', 'move', 'service', 'repair', name='ck_ticket_type', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('priority', sa.Enum('low', 'normal', 'high', name='ck_ticket_priority', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('status', sa.Enum('new', 'in_progress', 'done', 'rejected', 'closed', name='ck_ticket_status', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('closed_at', sa.DateTime(), nullable=True),
    sa.Column('equipment_id', sa.Integer(), nullable=True),
    sa.Column('requester_id', sa.Integer(), nullable=False),
    sa.Column('assignee_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['assignee_id'], ['app_user.user_id'], ),
    sa.ForeignKeyConstraint(['equipment_id'], ['equipment.equipment_id'], ),
    sa.ForeignKeyConstraint(['requester_id'], ['employee.employee_id'], ),
    sa.PrimaryKeyConstraint('ticket_id')
    )
    op.create_index(op.f('ix_ticket_assignee_id'), 'ticket', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_ticket_equipment_id'), 'ticket', ['equipment_id'], unique=False)
    op.create_index(op.f('ix_ticket_requester_id'), 'ticket', ['requester_id'], unique=False)
    op.create_table('ticket_work',
    sa.Column('ticket_id', sa.Integer(), nullable=False),
    sa.Column('work_no', sa.SmallInteger(), autoincrement=False, nullable=False),
    sa.Column('performed_at', sa.DateTime(), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('minutes_spent', sa.SmallInteger(), nullable=True),
    sa.Column('result', sa.String(length=255), nullable=True),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['ticket_id'], ['ticket.ticket_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['app_user.user_id'], ),
    sa.PrimaryKeyConstraint('ticket_id', 'work_no')
    )
    op.create_index(op.f('ix_ticket_work_user_id'), 'ticket_work', ['user_id'], unique=False)
