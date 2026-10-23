export type Scalar = string | number | boolean | null;
export type CatalogRecord = Record<string, Scalar>;

export interface Page<T> {
  items: T[];
  total: number;
}

export type Permission =
  | 'manage_users'
  | 'view_audit_log'
  | 'manage_catalogs'
  | 'manage_equipment'
  | 'assign_equipment'
  | 'process_tickets'
  | 'create_tickets'
  | 'conduct_inventory'
  | 'prepare_writeoff'
  | 'approve_writeoff'
  | 'view_reports';

export type RoleCode = 'admin' | 'sysadmin' | 'head' | 'dept_head' | 'employee';

export interface Role {
  role_id: number;
  code: RoleCode;
  name: string;
  description: string | null;
}

export interface User {
  user_id: number;
  login: string;
  is_active: boolean;
  last_login_at: string | null;
  role: Role;
  employee: { employee_id: number; full_name: string; dept_id: number };
}

export interface CurrentUser extends User {
  permissions: Permission[];
  scope: 'all' | 'department' | 'own';
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: CurrentUser;
}

export type EquipmentStatus = 'in_stock' | 'in_use' | 'in_repair' | 'pending_writeoff' | 'written_off';

export interface EquipmentListItem {
  equipment_id: number;
  inventory_no: string;
  serial_no: string | null;
  hostname: string | null;
  status: EquipmentStatus;
  model_id: number;
  model_name: string;
  type_id: number;
  type_name: string;
  manufacturer_name: string;
  os_id: number | null;
  os_name: string | null;
  workplace_id: number | null;
  workplace_no: string | null;
  room_id: number | null;
  room_no: string | null;
  mol_id: number | null;
  mol_name: string | null;
  holder_id: number | null;
  holder_name: string | null;
  commissioned_on: string | null;
  service_end: string | null;
  book_value: number | null;
}

export interface AssignmentRecord {
  assigned_at: string;
  operation: 'assign' | 'move' | 'return';
  basis: string | null;
  employee_name: string | null;
  workplace_no: string | null;
  user_login: string;
}

export interface EquipmentCard extends EquipmentListItem {
  cpu: string | null;
  ram_gb: number | null;
  storage_gb: number | null;
  ip_address: string | null;
  dept_name: string | null;
  assignments: AssignmentRecord[];
}

export interface AuditLogEntry {
  log_id: number;
  occurred_at: string;
  user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
}
