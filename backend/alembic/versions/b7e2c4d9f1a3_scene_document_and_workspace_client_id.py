"""scene document: wall graph moves into floor_plans.scene, workspaces get client_id

Revision ID: b7e2c4d9f1a3
Revises: a1c9e6f2b3d4
Create Date: 2026-10-16 17:30:00.000000

Геометрия плана (узлы и сегменты стен, дальше — двери и окна) переезжает из
таблиц wall_nodes/wall_segments в один документ floor_plans.scene (JSONB в
PostgreSQL, JSON в SQLite) с версией формата в floor_plans.scene_version.
Существующие стены переносятся как документ version 2; id узлов и сегментов
в документе — строки "node-<старый id>" / "wall-<старый id>".

Рабочие места остаются таблицей, но получают client_id — постоянный id с
фронтенда, по которому PUT обновляет строку, а не пересоздаёт её.
Существующим местам проставляется "workspace-<id>".

Откат возвращает таблицы стен из документа. Двери и окна (version 3) при
откате теряются — в старой схеме для них нет места.
"""
from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'b7e2c4d9f1a3'
down_revision: Union[str, None] = 'a1c9e6f2b3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SceneJSON = sa.JSON().with_variant(JSONB(), "postgresql")

floor_plans = sa.table(
    'floor_plans',
    sa.column('id', sa.Integer()),
    sa.column('scene', SceneJSON),
    sa.column('scene_version', sa.SmallInteger()),
)
wall_nodes = sa.table(
    'wall_nodes',
    sa.column('id', sa.Integer()),
    sa.column('floor_plan_id', sa.Integer()),
    sa.column('x', sa.Float()),
    sa.column('y', sa.Float()),
)
wall_segments = sa.table(
    'wall_segments',
    sa.column('id', sa.Integer()),
    sa.column('floor_plan_id', sa.Integer()),
    sa.column('start_node_id', sa.Integer()),
    sa.column('end_node_id', sa.Integer()),
    sa.column('thickness', sa.Float()),
)


def _create_wall_tables() -> None:
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


def _drop_wall_tables() -> None:
    op.drop_index(op.f('ix_wall_segments_floor_plan_id'), table_name='wall_segments')
    op.drop_table('wall_segments')
    op.drop_index(op.f('ix_wall_nodes_floor_plan_id'), table_name='wall_nodes')
    op.drop_table('wall_nodes')


def upgrade() -> None:
    bind = op.get_bind()

    with op.batch_alter_table('floor_plans') as batch:
        batch.add_column(sa.Column('scene', SceneJSON, nullable=True))
        batch.add_column(sa.Column('scene_version', sa.SmallInteger(), nullable=True))
    with op.batch_alter_table('workspaces') as batch:
        batch.add_column(sa.Column('client_id', sa.String(length=64), nullable=True))

    scenes: dict[int, dict[str, list[dict[str, Any]]]] = {
        plan_id: {'nodes': [], 'segments': []}
        for plan_id in bind.execute(sa.select(floor_plans.c.id)).scalars()
    }
    for node in bind.execute(sa.select(wall_nodes).order_by(wall_nodes.c.id)):
        scenes[node.floor_plan_id]['nodes'].append(
            {'id': f'node-{node.id}', 'x': float(node.x), 'y': float(node.y)}
        )
    for segment in bind.execute(sa.select(wall_segments).order_by(wall_segments.c.id)):
        scenes[segment.floor_plan_id]['segments'].append(
            {
                'id': f'wall-{segment.id}',
                'start_node_id': f'node-{segment.start_node_id}',
                'end_node_id': f'node-{segment.end_node_id}',
                'thickness': float(segment.thickness),
            }
        )
    for plan_id, scene in scenes.items():
        bind.execute(
            floor_plans.update()
            .where(floor_plans.c.id == plan_id)
            .values(scene={**scene, 'openings': []}, scene_version=2)
        )
    bind.execute(sa.text("UPDATE workspaces SET client_id = 'workspace-' || id"))

    with op.batch_alter_table('floor_plans') as batch:
        batch.alter_column('scene', existing_type=SceneJSON, nullable=False)
        batch.alter_column('scene_version', existing_type=sa.SmallInteger(), nullable=False)
        batch.create_check_constraint(op.f('ck_floor_plans_width_positive'), 'width_cm > 0')
        batch.create_check_constraint(op.f('ck_floor_plans_height_positive'), 'height_cm > 0')
        batch.create_check_constraint(
            op.f('ck_floor_plans_scene_version_known'), 'scene_version BETWEEN 2 AND 3'
        )
    with op.batch_alter_table('workspaces') as batch:
        batch.alter_column('client_id', existing_type=sa.String(length=64), nullable=False)
        batch.create_unique_constraint(
            op.f('uq_workspaces_floor_plan_client_id'), ['floor_plan_id', 'client_id']
        )
        batch.create_check_constraint(op.f('ck_workspaces_width_positive'), 'width > 0')
        batch.create_check_constraint(op.f('ck_workspaces_height_positive'), 'height > 0')

    _drop_wall_tables()


def downgrade() -> None:
    bind = op.get_bind()
    _create_wall_tables()

    # Таблицы стен только что созданы пустыми — id назначаем сами по порядку,
    # строковые id документа сопоставляем им через node_ids.
    next_node_id = 1
    next_segment_id = 1
    plans = bind.execute(sa.select(floor_plans.c.id, floor_plans.c.scene)).all()
    for plan in plans:
        scene = plan.scene or {}
        node_ids: dict[str, int] = {}
        for node in scene.get('nodes', []):
            bind.execute(
                wall_nodes.insert().values(
                    id=next_node_id, floor_plan_id=plan.id, x=node['x'], y=node['y']
                )
            )
            node_ids[node['id']] = next_node_id
            next_node_id += 1
        for segment in scene.get('segments', []):
            bind.execute(
                wall_segments.insert().values(
                    id=next_segment_id,
                    floor_plan_id=plan.id,
                    start_node_id=node_ids[segment['start_node_id']],
                    end_node_id=node_ids[segment['end_node_id']],
                    thickness=segment['thickness'],
                )
            )
            next_segment_id += 1
    if bind.dialect.name == 'postgresql':
        # Явные id не двигают sequence — без этого следующая вставка в старой
        # схеме упала бы на дубликате первичного ключа.
        bind.execute(sa.text("SELECT setval(pg_get_serial_sequence('wall_nodes', 'id'), GREATEST(:n, 1), :n > 0)"), {'n': next_node_id - 1})
        bind.execute(sa.text("SELECT setval(pg_get_serial_sequence('wall_segments', 'id'), GREATEST(:n, 1), :n > 0)"), {'n': next_segment_id - 1})

    with op.batch_alter_table('workspaces') as batch:
        batch.drop_constraint(op.f('ck_workspaces_height_positive'), type_='check')
        batch.drop_constraint(op.f('ck_workspaces_width_positive'), type_='check')
        batch.drop_constraint(op.f('uq_workspaces_floor_plan_client_id'), type_='unique')
        batch.drop_column('client_id')
    with op.batch_alter_table('floor_plans') as batch:
        batch.drop_constraint(op.f('ck_floor_plans_scene_version_known'), type_='check')
        batch.drop_constraint(op.f('ck_floor_plans_height_positive'), type_='check')
        batch.drop_constraint(op.f('ck_floor_plans_width_positive'), type_='check')
        batch.drop_column('scene_version')
        batch.drop_column('scene')
