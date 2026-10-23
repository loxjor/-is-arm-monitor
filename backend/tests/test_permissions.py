from app.core.permissions import ROLE_PERMISSIONS, ROLE_SCOPE, DataScope, Permission, RoleCode


def test_every_role_has_permissions_and_scope() -> None:
    assert set(ROLE_PERMISSIONS) == set(RoleCode)
    assert set(ROLE_SCOPE) == set(RoleCode)


def test_matrix_matches_table_1_2() -> None:
    assert ROLE_PERMISSIONS[RoleCode.admin] == frozenset(Permission)
    # Согласует списание только начальник отдела (и администратор с полным доступом).
    approvers = {r for r, perms in ROLE_PERMISSIONS.items() if Permission.approve_writeoff in perms}
    assert approvers == {RoleCode.admin, RoleCode.head}
    # Готовит списание системный администратор, но не согласует сам.
    assert Permission.prepare_writeoff in ROLE_PERMISSIONS[RoleCode.sysadmin]
    assert Permission.approve_writeoff not in ROLE_PERMISSIONS[RoleCode.sysadmin]
    assert ROLE_SCOPE[RoleCode.dept_head] is DataScope.department
    assert ROLE_SCOPE[RoleCode.employee] is DataScope.own
