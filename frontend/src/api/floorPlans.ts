import type { WallData } from '../types/wall';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { SceneData } from '../types/scene';
import { cm } from '../utils/scale';
import { generateId } from '../utils/id';

// TODO(Этап 4+): вынести в конфигурацию сборки (import.meta.env), когда
// появится реальное развёртывание с отдельным адресом бэкенда.
const API_BASE_URL = 'http://localhost:8000/api/v1';

const DEFAULT_PLAN_NAME = 'Мой план';
// Пока во фронтенде нет UI для размера сцены (статичная сетка ±100 м) —
// разумный дефолт, не завязанный на текущий зум/окно браузера.
const DEFAULT_SCENE_SIZE_CM = 5000;

interface WallPayload {
  x: number;
  y: number;
  length: number;
  thickness: number;
  rotation: number;
}

interface WorkspacePayload {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  status: WorkspaceStatus;
}

interface WallResponse extends WallPayload {
  id: number;
}

interface WorkspaceResponse extends WorkspacePayload {
  id: number;
}

interface FloorPlanResponse {
  id: number;
  name: string;
  width_cm: number;
  height_cm: number;
  background_image_url: string | null;
  created_at: string;
  updated_at: string;
  walls: WallResponse[];
  workspaces: WorkspaceResponse[];
}

function toWallPayload(wall: WallData): WallPayload {
  return {
    x: wall.x,
    y: wall.y,
    length: wall.length,
    thickness: wall.thickness,
    rotation: wall.rotation,
  };
}

function toWorkspacePayload(workspace: WorkspaceData): WorkspacePayload {
  return {
    x: workspace.x,
    y: workspace.y,
    width: workspace.width,
    height: workspace.height,
    rotation: workspace.rotation,
    label: workspace.label,
    status: workspace.status,
  };
}

// У стен/рабочих мест с сервера — целочисленный id БД, а не тот
// string-идентификатор, которым оперирует Konva-сцена. Это разные
// идентичности (серверная — персистентность, локальная — узел на холсте),
// поэтому при загрузке генерируем свежий локальный id, а не переиспользуем
// серверный.
function fromWallResponse(wall: WallResponse): WallData {
  return {
    id: generateId('wall'),
    x: cm(wall.x),
    y: cm(wall.y),
    length: cm(wall.length),
    thickness: cm(wall.thickness),
    rotation: wall.rotation,
  };
}

function fromWorkspaceResponse(workspace: WorkspaceResponse): WorkspaceData {
  return {
    id: generateId('workspace'),
    x: cm(workspace.x),
    y: cm(workspace.y),
    width: cm(workspace.width),
    height: cm(workspace.height),
    rotation: workspace.rotation,
    label: workspace.label,
    status: workspace.status,
  };
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) {
      return body.detail;
    }
  } catch {
    // тело не JSON или пустое — используем только статус
  }
  return `HTTP ${response.status}`;
}

/**
 * Сохраняет план: POST, если existingId ещё нет (план ни разу не
 * сохранялся в этой сессии/на этом устройстве), иначе PUT — заменяет
 * содержимое целиком. Возвращает id, под которым план лежит на сервере —
 * вызывающий код обязан его запомнить (localStorage), иначе следующее
 * сохранение снова создаст новый план вместо обновления существующего.
 */
export async function saveFloorPlan(scene: SceneData, existingId: number | null): Promise<number> {
  const payload = {
    name: DEFAULT_PLAN_NAME,
    width_cm: DEFAULT_SCENE_SIZE_CM,
    height_cm: DEFAULT_SCENE_SIZE_CM,
    background_image_url: null,
    walls: scene.walls.map(toWallPayload),
    workspaces: scene.workspaces.map(toWorkspacePayload),
  };

  const url =
    existingId === null
      ? `${API_BASE_URL}/floor-plans`
      : `${API_BASE_URL}/floor-plans/${existingId}`;

  const response = await fetch(url, {
    method: existingId === null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const data = (await response.json()) as FloorPlanResponse;
  return data.id;
}

/** Загружает план и переводит его в формат SceneData (см. FloorPlanCanvas.loadScene). */
export async function loadFloorPlan(id: number): Promise<SceneData> {
  const response = await fetch(`${API_BASE_URL}/floor-plans/${id}`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const data = (await response.json()) as FloorPlanResponse;
  return {
    version: 1,
    walls: data.walls.map(fromWallResponse),
    workspaces: data.workspaces.map(fromWorkspaceResponse),
  };
}
