"""inventory scope and checked

Revision ID: a7b4d8e9c2f1
Revises: f1a2b3c4d5e6
Create Date: 2026-10-29 14:30:00.000000

Инвентаризация по территории (зданию) и кабинету: к записи добавляются
building_id и room_id, а к результату — признак «проверена» (checked), чтобы
отличать непроверенную единицу от найденной/не найденной.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b4d8e9c2f1'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('inventory') as batch:
        batch.add_column(sa.Column('building_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('room_id', sa.Integer(), nullable=True))
        batch.create_foreign_key(
            'fk_inventory_building_id_building', 'building', ['building_id'], ['building_id']
        )
        batch.create_foreign_key(
            'fk_inventory_room_id_room', 'room', ['room_id'], ['room_id']
        )
        batch.create_index(op.f('ix_inventory_building_id'), ['building_id'])
        batch.create_index(op.f('ix_inventory_room_id'), ['room_id'])

    # Просто ADD COLUMN с DEFAULT: у SQLite это допустимо, и таблицу с
    # составным первичным ключом и CHECK-ограничением не пересоздаём.
    op.add_column(
        'inventory_result',
        sa.Column('checked', sa.Boolean(), nullable=False, server_default=sa.text('0')),
    )


def downgrade() -> None:
    op.drop_column('inventory_result', 'checked')

    with op.batch_alter_table('inventory') as batch:
        batch.drop_index(op.f('ix_inventory_room_id'))
        batch.drop_index(op.f('ix_inventory_building_id'))
        batch.drop_constraint('fk_inventory_room_id_room', type_='foreignkey')
        batch.drop_constraint('fk_inventory_building_id_building', type_='foreignkey')
        batch.drop_column('room_id')
        batch.drop_column('building_id')
