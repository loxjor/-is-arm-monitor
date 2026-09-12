"""wall graph: nodes and segments replace walls

Revision ID: a1c9e6f2b3d4
Revises: 3db7f7537284
Create Date: 2026-09-11 20:30:00.000000

Заменяет модель "стена = независимый отрезок" графом узлов и рёбер (Этап 5
TASKS.md): соседние стены должны делить общую вершину угла, а не просто
совпадать по координатам. Таблица walls удаляется, а не мигрируется —
сохранённых планов в базе на момент этой миграции ещё нет (см. отчёт по
Этапу 5.2), поэтому переносить в ней нечего; при наличии реальных данных
на момент апгрейда эту миграцию нужно было бы переписать на перенос вместо
простой замены.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c9e6f2b3d4'
down_revision: Union[str, None] = '3db7f7537284'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_walls_floor_plan_id'), table_name='walls')
    op.drop_table('walls')

    op.create_table(
        'wall_nodes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('floor_plan_id', sa.Integer(), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['floor_plan_id'], ['floor_plans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_wall_nodes_floor_plan_id'), 'wall_nodes', ['floor_plan_id'], unique=False)

    op.create_table(
        'wall_segments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('floor_plan_id', sa.Integer(), nullable=False),
        sa.Column('start_node_id', sa.Integer(), nullable=False),
        sa.Column('end_node_id', sa.Integer(), nullable=False),
        sa.Column('thickness', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['floor_plan_id'], ['floor_plans.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['start_node_id'], ['wall_nodes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['end_node_id'], ['wall_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_wall_segments_floor_plan_id'), 'wall_segments', ['floor_plan_id'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_wall_segments_floor_plan_id'), table_name='wall_segments')
    op.drop_table('wall_segments')
    op.drop_index(op.f('ix_wall_nodes_floor_plan_id'), table_name='wall_nodes')
    op.drop_table('wall_nodes')

    op.create_table(
        'walls',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('floor_plan_id', sa.Integer(), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('length', sa.Float(), nullable=False),
        sa.Column('thickness', sa.Float(), nullable=False),
        sa.Column('rotation', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['floor_plan_id'], ['floor_plans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_walls_floor_plan_id'), 'walls', ['floor_plan_id'], unique=False)
