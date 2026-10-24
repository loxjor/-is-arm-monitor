"""Демо-данные учётной части: роли, справочники, оборудование, пользователи, история назначений.

Запуск: `python -m app.seed` (после `alembic upgrade head`). Каждая часть
заполняется, только если её таблицы пусты, поэтому повторный запуск безопасен.
Пароль демо-пользователей — SEED_PASSWORD из .env; если не задан, генерируется
и выводится один раз.
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.schemas.floor_plan import FloorPlanCreate
from app.services import floor_plan_service
from app.models import (
    AppUser,
    Assignment,
    AssignmentOperation,
    Building,
    Department,
    Employee,
    Equipment,
    EquipmentModel,
    EquipmentStatus,
    EquipmentType,
    FloorPlan,
    Manufacturer,
    OperatingSystem,
    Role,
    Room,
    Ticket,
    TicketPriority,
    TicketStatus,
    TicketType,
    TicketWork,
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

    if db.scalar(select(Assignment).limit(1)) is None:
        seed_history(db)
    else:
        print("История назначений уже есть — пропуск.")

    if db.scalar(select(Ticket).limit(1)) is None:
        seed_tickets(db)
    else:
        print("Заявки уже есть — пропуск.")

    if db.scalar(select(Department).where(Department.head_employee_id.is_not(None)).limit(1)) is None:
        seed_department_heads(db)

    if db.scalar(select(FloorPlan).limit(1)) is None:
        seed_floor_plan(db)


def seed_floor_plan(db: Session) -> None:
    """План 3 этажа: кабинеты 301 и 302 с перегородкой и столами по номерам рабочих мест."""
    occupied = {
        workplace_no
        for (workplace_no,) in db.execute(
            select(Workplace.workplace_no)
            .join(Equipment, Equipment.workplace_id == Workplace.workplace_id)
            .where(Equipment.status == EquipmentStatus.in_use)
        ).tuples()
    }
    nodes = {"a": (0, 0), "b": (600, 0), "c": (1100, 0), "d": (1100, 500), "e": (600, 500), "f": (0, 500)}
    walls = [("a", "b"), ("b", "c"), ("c", "d"), ("d", "e"), ("e", "f"), ("f", "a"), ("b", "e")]
    desks = {
        "301-1": (60, 60), "301-2": (240, 60), "301-3": (420, 60),
        "302-1": (660, 60), "302-2": (840, 60), "302-3": (660, 300),
    }
    floor_plan_service.create_floor_plan(
        db,
        FloorPlanCreate(
            name="Главное здание, 3 этаж (каб. 301–302)",
            width_cm=1200,
            height_cm=600,
            scene={
                "version": 2,
                "nodes": [{"id": key, "x": x, "y": y} for key, (x, y) in nodes.items()],
                "segments": [
                    {"id": f"{a}{b}", "start_node_id": a, "end_node_id": b, "thickness": 15} for a, b in walls
                ],
            },
            workspaces=[
                {
                    # client_id по номеру рабочего места из справочника — задел
                    # под связь стола на карте с учётным рабочим местом.
                    "client_id": f"wp-{number}",
                    "x": x, "y": y, "width": 120, "height": 80, "rotation": 0, "label": f"РМ {number}",
                    "status": "occupied" if number in occupied else "free",
                }
                for number, (x, y) in desks.items()
            ],
        ),
    )
    print("Демо-план этажа добавлен.")


def seed_department_heads(db: Session) -> None:
    heads = {
        "ОА-1": "Петров Сергей Алексеевич",
        "ОТП": "Волкова Елена Игоревна",
        "ОУХ СВТ": "Кузнецов Дмитрий Олегович",
    }
    employees = {e.full_name: e for e in db.scalars(select(Employee))}
    for department in db.scalars(select(Department).where(Department.short_name.in_(heads))):
        head = employees.get(heads[department.short_name or ""])
        if head is not None:
            department.head_employee_id = head.employee_id
    db.commit()
    print("Руководители подразделений назначены.")


def seed_tickets(db: Session) -> None:
    sysadmin = db.scalar(select(AppUser).join(Role).where(Role.code == "sysadmin"))
    employees = {e.full_name: e for e in db.scalars(select(Employee))}
    by_workplace = {
        (wp_no, type_name): equipment
        for equipment, wp_no, type_name in db.execute(
            select(Equipment, Workplace.workplace_no, EquipmentType.name)
            .join(Workplace, Equipment.workplace_id == Workplace.workplace_id)
            .join(EquipmentModel, Equipment.model_id == EquipmentModel.model_id)
            .join(EquipmentType, EquipmentModel.type_id == EquipmentType.type_id)
        ).tuples()
    }
    monitor = by_workplace.get(("301-1", "Монитор"))
    pc = by_workplace.get(("301-2", "Системный блок"))
    if sysadmin is None or monitor is None or pc is None:
        return

    db.add(
        Ticket(
            created_at=datetime.now().replace(microsecond=0) - timedelta(hours=3),
            ticket_type=TicketType.repair,
            description="Монитор мерцает и периодически гаснет",
            priority=TicketPriority.high,
            status=TicketStatus.new,
            equipment_id=monitor.equipment_id,
            requester_id=employees["Смирнова Анна Викторовна"].employee_id,
        )
    )
    in_progress = Ticket(
        created_at=datetime.now().replace(microsecond=0) - timedelta(days=1),
        ticket_type=TicketType.service,
        description="Установить отечественный офисный пакет",
        priority=TicketPriority.normal,
        status=TicketStatus.in_progress,
        equipment_id=pc.equipment_id,
        requester_id=employees["Петров Сергей Алексеевич"].employee_id,
        assignee_id=sysadmin.user_id,
    )
    db.add(in_progress)
    db.flush()
    db.add(
        TicketWork(
            ticket_id=in_progress.ticket_id,
            work_no=1,
            performed_at=datetime.now().replace(microsecond=0) - timedelta(hours=20),
            description="Скачан дистрибутив, согласовано время установки",
            minutes_spent=15,
            user_id=sysadmin.user_id,
        )
    )
    db.commit()
    print("Заявки добавлены.")


def seed_history(db: Session) -> None:
    """Оформляет уже стоящую в эксплуатации технику назначениями — чтобы история не была пустой."""
    sysadmin = db.scalar(select(AppUser).join(Role).where(Role.code == "sysadmin"))
    employees = {e.full_name: e for e in db.scalars(select(Employee))}
    if sysadmin is None:
        return
    placed = db.scalars(
        select(Equipment).where(Equipment.status == EquipmentStatus.in_use, Equipment.workplace_id.is_not(None))
    )
    for equipment in placed:
        workplace = db.get(Workplace, equipment.workplace_id)
        # Рабочее место 301-1 — демо-сотрудника «employee», остальные — начальника отдела.
        holder = "Смирнова Анна Викторовна" if workplace and workplace.workplace_no == "301-1" else "Петров Сергей Алексеевич"
        assigned_on = equipment.commissioned_on or date(2024, 1, 9)
        db.add(
            Assignment(
                equipment_id=equipment.equipment_id,
                assigned_at=datetime.combine(assigned_on, time(9, 0)),
                operation=AssignmentOperation.assign,
                basis="Ввод в эксплуатацию",
                employee_id=employees[holder].employee_id,
                workplace_id=equipment.workplace_id,
                user_id=sysadmin.user_id,
            )
        )
    db.commit()
    print("История назначений добавлена.")


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
