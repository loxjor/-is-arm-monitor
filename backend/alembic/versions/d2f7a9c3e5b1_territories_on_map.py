"""territories on map

Revision ID: d2f7a9c3e5b1
Revises: c4d8e1a7f2b6
Create Date: 2026-10-28 17:00:00.000000

Территории на карте OpenStreetMap: у здания — координаты точки на доме,
у схемы (плана этажа) — здание, к которому она относится (одна схема на
здание), и описание.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f7a9c3e5b1'
down_revision: Union[str, None] = 'c4d8e1a7f2b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('building') as batch:
        batch.add_column(sa.Column('latitude', sa.Float(), nullable=True))
        batch.add_column(sa.Column('longitude', sa.Float(), nullable=True))
        batch.create_check_constraint(
            op.f('ck_building_coordinates_pair'), '(latitude IS NULL) = (longitude IS NULL)'
        )
    with op.batch_alter_table('floor_plans') as batch:
        batch.add_column(sa.Column('building_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('description', sa.Text(), nullable=True))
        batch.create_foreign_key(
            op.f('fk_floor_plans_building_id_building'), 'building', ['building_id'], ['building_id'],
            ondelete='SET NULL',
        )
        batch.create_index(op.f('ix_floor_plans_building_id'), ['building_id'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('floor_plans') as batch:
        batch.drop_index(op.f('ix_floor_plans_building_id'))
        batch.drop_constraint(op.f('fk_floor_plans_building_id_building'), type_='foreignkey')
        batch.drop_column('description')
        batch.drop_column('building_id')
    with op.batch_alter_table('building') as batch:
        batch.drop_constraint(op.f('ck_building_coordinates_pair'), type_='check')
        batch.drop_column('longitude')
        batch.drop_column('latitude')
