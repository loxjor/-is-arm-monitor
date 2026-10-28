"""equipment type specs

Revision ID: c4d8e1a7f2b6
Revises: c5e1f0a2b7d8
Create Date: 2026-10-28 12:00:00.000000

Характеристики оборудования по типу (монитор, принтер, сканер) и типы
«Принтер» и «Сканер» в справочнике — к уже существующим «Системный блок»,
«Монитор», «МФУ».
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d8e1a7f2b6'
down_revision: Union[str, None] = 'c5e1f0a2b7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TYPES = [('Принтер', 60), ('Сканер', 60)]


def upgrade() -> None:
    with op.batch_alter_table('equipment') as batch:
        batch.add_column(sa.Column('diagonal_inch', sa.Numeric(4, 1), nullable=True))
        batch.add_column(sa.Column('resolution', sa.String(length=20), nullable=True))
        batch.add_column(sa.Column('connection_type', sa.String(length=50), nullable=True))
        batch.add_column(sa.Column('is_color', sa.Boolean(), nullable=True))
        batch.add_column(sa.Column('cartridge_type', sa.String(length=100), nullable=True))
        batch.add_column(sa.Column('drum_type', sa.String(length=100), nullable=True))
        batch.add_column(sa.Column('scan_modes', sa.String(length=50), nullable=True))

    connection = op.get_bind()
    for name, months in NEW_TYPES:
        exists = connection.execute(
            sa.text('SELECT 1 FROM equipment_type WHERE name = :name'), {'name': name}
        ).first()
        if exists is None:
            connection.execute(
                sa.text('INSERT INTO equipment_type (name, service_life_months) VALUES (:name, :months)'),
                {'name': name, 'months': months},
            )


def downgrade() -> None:
    with op.batch_alter_table('equipment') as batch:
        for column in ('scan_modes', 'drum_type', 'cartridge_type', 'is_color',
                       'connection_type', 'resolution', 'diagonal_inch'):
            batch.drop_column(column)
    # Типы «Принтер» и «Сканер» остаются: на них могут ссылаться модели.
