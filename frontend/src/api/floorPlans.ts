import type { WallNode, WallSegment } from '../types/wall';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { SceneData } from '../types/scene';
import { cm } from '../utils/scale';

// Относительный адрес: Vite проксирует /api на бэкенд (vite.config.ts), поэтому
// карта работает с любого адреса dev-сервера и в учётной части, без CORS.
const API_BASE_URL = '/api/v1';

const DEFAULT_PLAN_NAME = 'Мой план';
// Пока во фронтенде нет UI для размера сцены (статичная сетка ±100 м) —
// разумный дефолт, не завязанный на текущий зум/окно браузера.
const DEFAULT_SCENE_SIZE_CM = 5000;

// Геометрия едет на сервер одним документом scene (бэкенд хранит его как
// JSONB, см. backend/app/schemas/scene.py) — с теми же строковыми id, что на
// холсте, поэтому после загрузки ссылки сегментов на узлы остаются как есть.
// version 2 — пока у сцены на фронтенде нет дверей и окон.
interface SceneNodeDto {
  id: string;
  x: number;
  y: number;
}

interface SceneSegmentDto {
  id: string;
  start_node_id: string;
  end_node_id: string;
  thickness: number;
}

interface ScenePayload {
  version: 2;
  nodes: SceneNodeDto[];
  segments: SceneSegmentDto[];
}

interface SceneResponse {
  // Сервер отдаёт сцену в актуальной версии; openings появятся во
  // фронтендовой модели вместе с дверями и окнами.
  version: number;
  nodes: SceneNodeDto[];
  segments: SceneSegmentDto[];
  openings: unknown[];
}

interface WorkspacePayload {
  // id места на холсте — сервер обновляет рабочее место по нему на месте,
  // и строка в БД сохраняет свой id между сохранениями.
  client_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
  status: WorkspaceStatus;
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
  scene: SceneResponse;
  workspaces: WorkspaceResponse[];
}

function toScenePayload(scene: SceneData): ScenePayload {
  return {
    version: 2,
    nodes: scene.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    segments: scene.segments.map((segment) => ({
      id: segment.id,
      start_node_id: segment.startNodeId,
      end_node_id: segment.endNodeId,
      thickness: segment.thickness,
    })),
  };
}

function toWorkspacePayload(workspace: WorkspaceData): WorkspacePayload {
  return {
    client_id: workspace.id,
    x: workspace.x,
    y: workspace.y,
    width: workspace.width,
    height: workspace.height,
    rotation: workspace.rotation,
    label: workspace.label,
    status: workspace.status,
  };
}

function fromFloorPlanResponse(data: FloorPlanResponse): SceneData {
  const nodes: WallNode[] = data.scene.nodes.map((node) => ({
    id: node.id,
    x: cm(node.x),
    y: cm(node.y),
  }));
  const segments: WallSegment[] = data.scene.segments.map((segment) => ({
    id: segment.id,
    startNodeId: segment.start_node_id,
    endNodeId: segment.end_node_id,
    thickness: cm(segment.thickness),
  }));

  return {
    version: 2,
    nodes,
    segments,
    workspaces: data.workspaces.map(fromWorkspaceResponse),
  };
}

function fromWorkspaceResponse(workspace: WorkspaceResponse): WorkspaceData {
  return {
    id: workspace.client_id,
    x: cm(workspace.x),
    y: cm(workspace.y),
    width: cm(workspace.width),
    height: cm(workspace.height),
    rotation: workspace.rotation,
    label: workspace.label,
    status: workspace.status,
  };
}

/**
 * Ошибка API с HTTP-статусом — позволяет вызывающему коду различать причины
 * отказа (например, 404 "план не найден" от недоступности сервера), а не
 * судить по тексту сообщения.
 */
export class FloorPlanApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'FloorPlanApiError';
  }
}

/**
 * У FastAPI detail — не всегда строка: при 422 это массив объектов
 * ({type, loc, msg, ...}) с описанием ошибки на каждое поле. Дописываем
 * место и причину из первого элемента в скобках, только когда форма detail
 * действительно похожа на список ошибок валидации — во всех остальных
 * случаях (не JSON, detail — строка, массив пуст) молча ничего не добавляем,
 * а не показываем пользователю "[object Object]" или мусор.
 */
function formatValidationHint(detail: unknown): string {
  if (!Array.isArray(detail) || detail.length === 0) {
    return '';
  }
  const first = detail[0] as { msg?: unknown; loc?: unknown };
  if (typeof first?.msg !== 'string') {
    return '';
  }
  const loc = Array.isArray(first.loc) ? first.loc.join('.') : null;
  return loc ? ` (${loc}: ${first.msg})` : ` (${first.msg})`;
}

/**
 * Сообщение формирует клиент по коду ответа, а не пробрасывает наружу
 * текст сервера как есть — 404/422/остальное имеют разный смысл для
 * пользователя, а detail при 422 вообще не строка (см. formatValidationHint).
 */
async function buildHttpErrorMessage(response: Response): Promise<string> {
  if (response.status === 404) {
    return 'план не найден на сервере';
  }
  if (response.status === 422) {
    let detail: unknown;
    try {
      detail = ((await response.json()) as { detail?: unknown }).detail;
    } catch {
      // тело не JSON или пустое — сообщение обойдётся без уточнения
    }
    return `сервер отклонил данные плана${formatValidationHint(detail)}`;
  }
  return `ошибка сервера (HTTP ${response.status})`;
}

/**
 * fetch() сам бросает TypeError ("Failed to fetch"), когда сервер
 * недоступен — до того, как появляется какой-либо HTTP-статус. Это текст
 * браузера, не сервера, и показывать его пользователю как есть не нужно:
 * заворачиваем в тот же FloorPlanApiError с тем же понятным сообщением,
 * что было раньше жёстко зашито в main.ts.
 */
async function fetchFloorPlan(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new FloorPlanApiError('сервер недоступен', 0);
  }
}

/**
 * Сохраняет план: POST, если existingId ещё нет (план ни разу не
 * сохранялся в этой сессии/на этом устройстве), иначе PUT — заменяет
 * содержимое целиком. Возвращает id, под которым план лежит на сервере —
 * вызывающий код обязан его запомнить (localStorage), иначе следующее
 * сохранение снова создаст новый план вместо обновления существующего.
 */
export async function saveFloorPlan(
  scene: SceneData,
  existingId: number | null,
  // Имя открытого плана — иначе PUT молча переименовал бы его в «Мой план».
  name: string = DEFAULT_PLAN_NAME,
): Promise<number> {
  const payload = {
    name,
    width_cm: DEFAULT_SCENE_SIZE_CM,
    height_cm: DEFAULT_SCENE_SIZE_CM,
    background_image_url: null,
    scene: toScenePayload(scene),
    workspaces: scene.workspaces.map(toWorkspacePayload),
  };

  const url =
    existingId === null
      ? `${API_BASE_URL}/floor-plans`
      : `${API_BASE_URL}/floor-plans/${existingId}`;

  const response = await fetchFloorPlan(url, {
    method: existingId === null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new FloorPlanApiError(await buildHttpErrorMessage(response), response.status);
  }

  const data = (await response.json()) as FloorPlanResponse;
  return data.id;
}

export interface FloorPlanListItem {
  id: number;
  name: string;
  updated_at: string;
}

/** Список сохранённых планов (без геометрии) — для выбора в «Открыть». */
export async function listFloorPlans(): Promise<FloorPlanListItem[]> {
  const response = await fetchFloorPlan(`${API_BASE_URL}/floor-plans`);
  if (!response.ok) {
    throw new FloorPlanApiError(await buildHttpErrorMessage(response), response.status);
  }
  return (await response.json()) as FloorPlanListItem[];
}

/** Загружает план и переводит его в формат SceneData (см. FloorPlanCanvas.loadScene). */
export async function loadFloorPlan(id: number): Promise<SceneData> {
  const response = await fetchFloorPlan(`${API_BASE_URL}/floor-plans/${id}`);
  if (!response.ok) {
    throw new FloorPlanApiError(await buildHttpErrorMessage(response), response.status);
  }

  const data = (await response.json()) as FloorPlanResponse;
  return fromFloorPlanResponse(data);
}
