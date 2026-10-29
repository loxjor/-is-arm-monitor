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
}

export interface FloorPlanSummary {
  id: number;
  name: string;
  building_id: number | null;
  description: string | null;
  workspace_count: number;
  created_at: string;
  updated_at: string;
}

/** Схема территории — называется так же, как территория; этажи внутри неё. */
export interface TerritoryPlan {
  id: number;
  description: string | null;
  workspace_count: number;
  updated_at: string;
}

/** Территория — здание из справочника с точкой на карте OpenStreetMap. */
export interface MapTerritory {
  building_id: number;
  name: string;
  address: string;
  floors_count: number | null;
  latitude: number | null;
  longitude: number | null;
  /** null — схему ещё не создали. */
  plan: TerritoryPlan | null;
}

export interface MapConfig {
  tile_url: string;
  attribution: string;
  max_zoom: number;
  /** Запад, юг, восток, север — регион карты; за его пределы она не выходит. */
  bounds: [number, number, number, number];
  center: [number, number];
  zoom: number;
  geocoder: boolean;
}

export interface GeocodeResult {
  address: string;
  latitude: number;
  longitude: number;
}

export type InventoryStatus = 'open' | 'closed';
export type DiscrepancyKind = 'missing' | 'wrong_room' | 'extra';

export interface InventoryTerritory {
  building_id: number;
  name: string;
  address: string;
  equipment_count: number;
}

export interface InventoryRoom {
  room_id: number;
  room_no: string;
  floor: number;
  equipment_count: number;
}

export interface InventoryRecord {
  inventory_id: number;
  started_on: string;
  finished_on: string | null;
  basis: string;
  status: InventoryStatus;
  building_id: number | null;
  building_name: string | null;
  room_id: number | null;
  room_no: string | null;
  responsible_name: string | null;
  total_count: number;
  checked_count: number;
  present_count: number;
}

export interface InventoryItem {
  equipment_id: number;
  inventory_no: string;
  serial_no: string | null;
  model_name: string;
  type_name: string;
  manufacturer_name: string;
  room_no: string | null;
  workplace_no: string | null;
  mol_name: string | null;
  checked: boolean;
  is_present: boolean;
  discrepancy: DiscrepancyKind | null;
  note: string | null;
}

export interface InventoryDetail extends InventoryRecord {
  items: InventoryItem[];
}
