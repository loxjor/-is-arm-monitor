"""Матрица прав по ролям (табл. 1.2 курсового). Единственное место, где роль связана с правами."""

from __future__ import annotations

import enum


class RoleCode(str, enum.Enum):
    admin = "admin"
    sysadmin = "sysadmin"
    head = "head"
    dept_head = "dept_head"
    employee = "employee"


class Permission(str, enum.Enum):
    manage_users = "manage_users"
    view_audit_log = "view_audit_log"
    manage_catalogs = "manage_catalogs"
    manage_equipment = "manage_equipment"
    assign_equipment = "assign_equipment"
    process_tickets = "process_tickets"
    create_tickets = "create_tickets"
    conduct_inventory = "conduct_inventory"
    prepare_writeoff = "prepare_writeoff"
    approve_writeoff = "approve_writeoff"
    view_reports = "view_reports"
    # Чтение справочников (подразделения, сотрудники, помещения…) — не для рядового сотрудника.
    view_catalogs = "view_catalogs"


class DataScope(str, enum.Enum):
    """Какую часть реестра роль видит. Фильтр применяют сервисы, а не клиент."""

    all = "all"
    department = "department"
    own = "own"


ROLE_PERMISSIONS: dict[RoleCode, frozenset[Permission]] = {
    RoleCode.admin: frozenset(Permission),
    RoleCode.sysadmin: frozenset(
        {
            Permission.manage_catalogs,
            Permission.view_catalogs,
            Permission.manage_equipment,
            Permission.assign_equipment,
            Permission.process_tickets,
            Permission.create_tickets,
            Permission.conduct_inventory,
            Permission.prepare_writeoff,
        }
    ),
    RoleCode.head: frozenset({Permission.approve_writeoff, Permission.view_reports, Permission.view_catalogs}),
    RoleCode.dept_head: frozenset({Permission.create_tickets, Permission.view_reports, Permission.view_catalogs}),
    RoleCode.employee: frozenset({Permission.create_tickets}),
}

ROLE_SCOPE: dict[RoleCode, DataScope] = {
    RoleCode.admin: DataScope.all,
    RoleCode.sysadmin: DataScope.all,
    RoleCode.head: DataScope.all,
    RoleCode.dept_head: DataScope.department,
    RoleCode.employee: DataScope.own,
}


def has_permission(role: RoleCode, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]
