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
  | 'view_reports'
  | 'view_catalogs'
  | 'edit_floor_plans';

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
  building_address: string | null;
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
  diagonal_inch: number | null;
  resolution: string | null;
  connection_type: string | null;
  is_color: boolean | null;
  cartridge_type: string | null;
  drum_type: string | null;
  scan_modes: string | null;
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

export type TicketType = 'install' | 'move' | 'service' | 'repair';
export type TicketPriority = 'low' | 'normal' | 'high';
export type TicketStatus = 'new' | 'in_progress' | 'done' | 'rejected' | 'closed';

export interface TicketListItem {
  ticket_id: number;
  created_at: string;
  ticket_type: TicketType;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  closed_at: string | null;
  equipment_id: number | null;
  inventory_no: string | null;
  requester_id: number;
  requester_name: string;
  assignee_id: number | null;
  assignee_name: string | null;
}

export interface TicketWork {
  work_no: number;
  performed_at: string;
  description: string;
  minutes_spent: number | null;
  result: string | null;
  user_login: string;
}

export interface TicketCard extends TicketListItem {
  works: TicketWork[];
  can_transition_to: TicketStatus[];
  can_add_work: boolean;
}

export interface PersonBrief {
  employee_id: number;
  full_name: string;
  position: string;
  phone: string | null;
  email: string | null;
}

export interface Territory {
  workplace_id: number;
  workplace_no: string;
  room_no: string;
  floor: number;
  building_name: string;
  building_address: string;
}

export interface Profile {
  login: string;
  role_name: string;
  person: PersonBrief;
  is_mol: boolean;
  department: { dept_id: number; name: string; short_name: string | null; phone: string | null; parent_name: string | null };
  head: PersonBrief | null;
  territories: Territory[];
  equipment: EquipmentListItem[];
  open_tickets: number;
}

export interface FloorPlanSummary {
  id: number;
  name: string;
  updated_at: string;
}
