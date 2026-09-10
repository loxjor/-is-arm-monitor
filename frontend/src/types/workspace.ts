export type WorkspaceStatus = 'free' | 'occupied' | 'reserved';

export interface WorkspaceData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  status: WorkspaceStatus;
}
