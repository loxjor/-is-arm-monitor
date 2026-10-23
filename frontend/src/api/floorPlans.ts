import type { WallNode, WallSegment } from '../types/wall';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { SceneData } from '../types/scene';
import { cm } from '../utils/scale';
import { generateId } from '../utils/id';

// Относительный адрес: Vite проксирует /api на бэкенд (vite.config.ts), поэтому
// карта работает с любого адреса dev-сервера и в учётной части, без CORS.
const API_BASE_URL = '/api/v1';

const DEFAULT_PLAN_NAME = 'Мой план';
// Пока во фронтенде нет UI для размера сцены (статичная сетка ±100 м) —
// разумный дефолт, не завязанный на текущий зум/окно браузера.
const DEFAULT_SCENE_SIZE_CM = 5000;

interface WallNodePayload {
  // Узлы и сегменты создаются одним запросом, и на момент запроса у узла
  // ещё нет id БД, на который мог бы сослаться сегмент — client_id это
  // локальный id узла на фронтенде (WallNode.id), который сегмент несёт в
  // start_client_id/end_client_id (см. WallSegmentPayload и бэкендовую
  // схему WallNodeCreate/WallSegmentCreate).
  client_id: string;
  x: number;
  y: number;
}

interface WallSegmentPayload {
  start_client_id: string;
  end_client_id: string;
  thickness: number;
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

interface WallNodeResponse {
  id: number;
  x: number;
  y: number;
}

interface WallSegmentResponse {
  id: number;
  start_node_id: number;
  end_node_id: number;
  thickness: number;
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
  nodes: WallNodeResponse[];
  segments: WallSegmentResponse[];
  workspaces: WorkspaceResponse[];
}

function toNodePayload(node: WallNode): WallNodePayload {
  return { client_id: node.id, x: node.x, y: node.y };
}

function toSegmentPayload(segment: WallSegment): WallSegmentPayload {
  return {
    start_client_id: segment.startNodeId,
    end_client_id: segment.endNodeId,
    thickness: segment.thickness,
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

// У узлов/сегментов/рабочих мест с сервера — целочисленный id БД, а не тот
// string-идентификатор, которым оперирует Konva-сцена. Это разные
// идентичности (серверная — персистентность, локальная — узел на холсте),
// поэтому при загрузке генерируем свежие локальные id, а не переиспользуем
// серверные — и заодно перекладываем ссылки сегментов на узлы (start_node_id/
// end_node_id) через карту "серверный id → свежий локальный id".
function fromFloorPlanResponse(data: FloorPlanResponse): SceneData {
  const localNodeId = new Map<number, string>();
  const nodes: WallNode[] = data.nodes.map((node) => {
    const id = generateId('node');
    localNodeId.set(node.id, id);
    return { id, x: cm(node.x), y: cm(node.y) };
  });

  const segments: WallSegment[] = data.segments.map((segment) => ({
    id: generateId('wall'),
    startNodeId: localNodeId.get(segment.start_node_id)!,
    endNodeId: localNodeId.get(segment.end_node_id)!,
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
export async function saveFloorPlan(scene: SceneData, existingId: number | null): Promise<number> {
  const payload = {
    name: DEFAULT_PLAN_NAME,
    width_cm: DEFAULT_SCENE_SIZE_CM,
    height_cm: DEFAULT_SCENE_SIZE_CM,
    background_image_url: null,
    nodes: scene.nodes.map(toNodePayload),
    segments: scene.segments.map(toSegmentPayload),
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

/** Загружает план и переводит его в формат SceneData (см. FloorPlanCanvas.loadScene). */
export async function loadFloorPlan(id: number): Promise<SceneData> {
  const response = await fetchFloorPlan(`${API_BASE_URL}/floor-plans/${id}`);
  if (!response.ok) {
    throw new FloorPlanApiError(await buildHttpErrorMessage(response), response.status);
  }

  const data = (await response.json()) as FloorPlanResponse;
  return fromFloorPlanResponse(data);
}
