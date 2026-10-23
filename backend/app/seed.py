"""Демо-данные учётной части: роли, справочники, оборудование, пользователи.

Запуск: `python -m app.seed` (после `alembic upgrade head`). Каждая часть
заполняется, только если её таблицы пусты, поэтому повторный запуск безопасен.
Пароль демо-пользователей — SEED_PASSWORD из .env; если не задан, генерируется
и выводится один раз.
"""

from __future__ import annotations

import secrets
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    AppUser,
    Building,
    Department,
    Employee,
    Equipment,
    EquipmentModel,
    EquipmentStatus,
    EquipmentType,
    Manufacturer,
    OperatingSystem,
    Role,
    Room,
    Workplace,
)

ROLES = [
    ("admin", "Администратор ИС", "Полный доступ, учётные записи, роли, справочники, резервное копирование"),
    ("sysadmin", "Системный администратор", "Реестр АРМ, назначение и перемещение, заявки, инвентаризация, подготовка списания"),
    ("head", "Начальник отдела", "Согласование списания, просмотр всех данных, отчётность"),
    ("dept_head", "Руководитель подразделения", "Заявки и просмотр АРМ своего подразделения, отчёты по подразделению"),
    ("employee", "Сотрудник", "Просмотр закреплённого оборудования, подача заявок"),
]


# Логин → (код роли, ФИО сотрудника из демо-данных ниже)
DEMO_USERS = [
    ("admin", "admin", "Морозов Илья Павлович"),
    ("sysadmin", "sysadmin", "Кузнецов Дмитрий Олегович"),
    ("head", "head", "Петров Сергей Алексеевич"),
    ("depthead", "dept_head", "Волкова Елена Игоревна"),
    ("employee", "employee", "Смирнова Анна Викторовна"),
]


def seed(db: Session) -> None:
    if db.scalar(select(Role).limit(1)) is None:
        seed_reference_data(db)
        print("Справочники и оборудование добавлены.")
    else:
        print("Справочники уже есть — пропуск.")

    if db.scalar(select(AppUser).limit(1)) is None:
        seed_users(db)
    else:
        print("Пользователи уже есть — пропуск.")


def seed_users(db: Session) -> None:
    password = settings.SEED_PASSWORD or secrets.token_urlsafe(9)
    password_hash = hash_password(password)
    roles = {role.code: role for role in db.scalars(select(Role))}
    employees = {e.full_name: e for e in db.scalars(select(Employee))}
    for login, role_code, full_name in DEMO_USERS:
        db.add(
            AppUser(
                login=login,
                password_hash=password_hash,
                role=roles[role_code],
                employee=employees[full_name],
                is_active=True,
            )
        )
    db.commit()
    logins = ", ".join(login for login, _, _ in DEMO_USERS)
    print(f"Пользователи добавлены: {logins}.")
    if settings.SEED_PASSWORD is None:
        print(f"Сгенерированный пароль для всех: {password}")


def seed_reference_data(db: Session) -> None:
    db.add_all(Role(code=c, name=n, description=d) for c, n, d in ROLES)

    uit = Department(name="Управление информационных технологий", short_name="УИТ", phone="8-495-000-00-00")
    automation = Department(name="Отдел автоматизации № 1", short_name="ОА-1", parent=uit)
    storage = Department(name="Отдел учёта и хранения СВТ", short_name="ОУХ СВТ", parent=uit)
    support = Department(name="Отдел технической поддержки объектов г. Москвы", short_name="ОТП", parent=uit)
    db.add_all([uit, automation, storage, support])

    employees = [
        Employee(full_name="Петров Сергей Алексеевич", position="Начальник отдела", is_mol=True, department=automation),
        Employee(full_name="Смирнова Анна Викторовна", position="Ведущий специалист", is_mol=False, department=automation),
        Employee(full_name="Кузнецов Дмитрий Олегович", position="Главный специалист-эксперт", is_mol=True, department=storage),
        Employee(full_name="Волкова Елена Игоревна", position="Начальник отдела", is_mol=True, department=support),
        Employee(full_name="Морозов Илья Павлович", position="Системный администратор", is_mol=False, department=support),
    ]
    db.add_all(employees)

    building = Building(name="Главное здание", address="г. Москва, пер. Орликов, д. 3, корп. А", floors_count=8)
    db.add(building)

    rooms = [
        Room(room_no="301", floor=3, area=Decimal("42.50"), building=building, department=automation),
        Room(room_no="302", floor=3, area=Decimal("36.00"), building=building, department=automation),
        Room(room_no="105", floor=1, area=Decimal("60.00"), building=building, department=storage),
    ]
    db.add_all(rooms)

    workplaces = [
        Workplace(workplace_no=f"{room.room_no}-{n}", x=Decimal(150 * n), y=Decimal("200.00"), room=room)
        for room in rooms[:2]
        for n in range(1, 4)
    ]
    db.add_all(workplaces)

    pc = EquipmentType(name="Системный блок", service_life_months=60)
    monitor = EquipmentType(name="Монитор", service_life_months=84)
    printer = EquipmentType(name="МФУ", service_life_months=60)
    db.add_all([pc, monitor, printer])

    aquarius = Manufacturer(name="Аквариус", country="Россия")
    iru = Manufacturer(name="iRU", country="Россия")
    pantum = Manufacturer(name="Pantum", country="Китай")
    db.add_all([aquarius, iru, pantum])

    pc_model = EquipmentModel(
        name="Aquarius Pro P30 K44",
        specs="Intel Core i5, 16 ГБ ОЗУ, SSD 512 ГБ",
        equipment_type=pc,
        manufacturer=aquarius,
    )
    monitor_model = EquipmentModel(name="iRU 2408", specs="23,8\", IPS, 1920×1080", equipment_type=monitor, manufacturer=iru)
    printer_model = EquipmentModel(name="Pantum M7100DW", specs="Ч/б лазерное, A4, сеть", equipment_type=printer, manufacturer=pantum)
    db.add_all([pc_model, monitor_model, printer_model])

    win10 = OperatingSystem(name="Windows 10 Pro", version="22H2", is_domestic=False)
    astra = OperatingSystem(name="Astra Linux SE", version="1.7", is_domestic=True)
    red = OperatingSystem(name="РЕД ОС", version="7.3", is_domestic=True)
    db.add_all([win10, astra, red])

    mol = employees[0]
    systems = [win10, astra, red, astra, astra, win10]
    for i, (workplace, os) in enumerate(zip(workplaces, systems), start=1):
        db.add(
            Equipment(
                inventory_no=f"ВТ-{1000 + i:06d}",
                serial_no=f"AQ{2024000 + i}",
                cpu="Intel Core i5-12400",
                ram_gb=16,
                storage_gb=512,
                hostname=f"OA1-PC{i:02d}",
                ip_address=f"10.77.3.{10 + i}",
                commissioned_on=date(2021 + i % 4, 3, 1),
                book_value=Decimal("58400.00"),
                status=EquipmentStatus.in_use,
                model=pc_model,
                operating_system=os,
                workplace=workplace,
                mol=mol,
            )
        )
        db.add(
            Equipment(
                inventory_no=f"ВТ-{2000 + i:06d}",
                commissioned_on=date(2019 + i % 4, 6, 1),
                book_value=Decimal("14200.00"),
                status=EquipmentStatus.in_use,
                model=monitor_model,
                workplace=workplace,
                mol=mol,
            )
        )

    storage_mol = employees[2]
    stock = [
        (f"ВТ-{1100 + i:06d}", pc_model, astra, EquipmentStatus.in_stock) for i in range(1, 4)
    ] + [
        ("ВТ-003001", printer_model, None, EquipmentStatus.in_repair),
        ("ВТ-000999", pc_model, win10, EquipmentStatus.pending_writeoff),
    ]
    for inventory_no, model, os, status in stock:
        db.add(
            Equipment(
                inventory_no=inventory_no,
                commissioned_on=date(2016, 1, 15) if status is EquipmentStatus.pending_writeoff else None,
                status=status,
                model=model,
                operating_system=os,
                mol=storage_mol,
            )
        )

    db.commit()


if __name__ == "__main__":
    with SessionLocal() as session:
        seed(session)
