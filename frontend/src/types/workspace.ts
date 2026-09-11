import type { Cm } from '../utils/scale';

export type WorkspaceStatus = 'free' | 'occupied' | 'reserved';

export interface WorkspaceData {
  id: string;
  x: Cm;
  y: Cm;
  width: Cm;
  height: Cm;
  rotation: number;
  label: string;
  status: WorkspaceStatus;
}
