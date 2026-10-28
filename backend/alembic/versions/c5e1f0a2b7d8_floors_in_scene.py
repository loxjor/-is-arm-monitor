"""floors in scene

Revision ID: c5e1f0a2b7d8
Revises: 3aa18ca7867a
Create Date: 2026-10-25 12:00:00.000000

Этажи внутри одного плана: сцена version 4 хранит список floors, рабочее
место знает свой этаж (floor_id, NULL — первый этаж). Старые документы
v2/v3 не переписываются — их поднимает до v4 upgrade_scene при чтении.
При откате многоэтажные планы теряют все этажи, кроме первого: в плоском
формате v3 для них нет места.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'c5e1f0a2b7d8'
down_revision: Union[str, None] = '3aa18ca7867a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SceneJSON = sa.JSON().with_variant(JSONB(), 'postgresql')


def upgrade() -> None:
    with op.batch_alter_table('floor_plans') as batch:
        batch.drop_constraint(op.f('ck_floor_plans_scene_version_known'), type_='check')
        batch.create_check_constraint(
            op.f('ck_floor_plans_scene_version_known'), 'scene_version BETWEEN 2 AND 4'
        )
    with op.batch_alter_table('workspaces') as batch:
        batch.add_column(sa.Column('floor_id', sa.String(length=64), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    floor_plans = sa.table(
        'floor_plans',
        sa.column('id', sa.Integer),
        sa.column('scene', SceneJSON),
        sa.column('scene_version', sa.SmallInteger),
    )
    rows = bind.execute(
        sa.select(floor_plans.c.id, floor_plans.c.scene).where(floor_plans.c.scene_version == 4)
    ).all()
    for plan_id, scene in rows:
        first = (scene.get('floors') or [{}])[0]
        flat = {key: first.get(key, []) for key in ('nodes', 'segments', 'openings', 'rooms')}
        bind.execute(
            sa.update(floor_plans).where(floor_plans.c.id == plan_id).values(scene=flat, scene_version=3)
        )

    with op.batch_alter_table('workspaces') as batch:
        batch.drop_column('floor_id')
    with op.batch_alter_table('floor_plans') as batch:
        batch.drop_constraint(op.f('ck_floor_plans_scene_version_known'), type_='check')
        batch.create_check_constraint(
            op.f('ck_floor_plans_scene_version_known'), 'scene_version BETWEEN 2 AND 3'
        )
