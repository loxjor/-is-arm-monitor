import type { WallNode, WallSegment } from '../types/wall';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { PlanData, PlanFloor, RoomLabel, SceneData } from '../types/scene';
import type { OpeningKind, WallOpening } from '../types/opening';
import type { FixtureData, FixtureKind } from '../types/fixture';
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
// version 4 — этажи, у каждого свои стены, проёмы и подписи помещений.
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

interface SceneRoomDto {
  id: string;
  x: number;
  y: number;
  title: string;
  note: string;
}

interface SceneOpeningDto {
  id: string;
  segment_id: string;
  kind: OpeningKind;
  offset: number;
  width: number;
  height: number;
  sill_height: number;
  hinge: 'start' | 'end' | null;
  swing: 'left' | 'right' | null;
}

interface SceneFixtureDto {
  id: string;
  kind: FixtureKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface SceneFloorDto {
  id: string;
  name: string;
  fixtures: SceneFixtureDto[];
  nodes: SceneNodeDto[];
  segments: SceneSegmentDto[];
  openings: SceneOpeningDto[];
  rooms: SceneRoomDto[];
}

interface ScenePayload {
  version: 4;
  floors: SceneFloorDto[];
}

interface SceneResponse {
  // Сервер отдаёт сцену в актуальной версии — старые планы одним этажом.
  version: number;
  floors: SceneFloorDto[];
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
  floor_id: string | null;
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

function toFloorPayload({ id, name, scene }: PlanFloor): SceneFloorDto {
  return {
    id,
    name,
    fixtures: (scene.fixtures ?? []).map((fixture) => ({ ...fixture })),
    nodes: scene.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    segments: scene.segments.map((segment) => ({
      id: segment.id,
      start_node_id: segment.startNodeId,
      end_node_id: segment.endNodeId,
      thickness: segment.thickness,
    })),
    openings: (scene.openings ?? []).map((opening) => ({
      id: opening.id,
      segment_id: opening.segmentId,
      kind: opening.kind,
      offset: opening.offset,
      width: opening.width,
      height: opening.height,
      sill_height: opening.sillHeight,
      hinge: opening.hinge,
      swing: opening.swing,
    })),
    rooms: (scene.rooms ?? []).map((room) => ({
      id: room.id,
      x: room.x,
      y: room.y,
      title: room.title,
      note: room.note,
    })),
  };
}

function toWorkspacePayload(workspace: WorkspaceData, floorId: string): WorkspacePayload {
  return {
    floor_id: floorId,
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

function fromFloorPlanResponse(data: FloorPlanResponse): PlanData {
  // Место без этажа (сохранено до этажей) — на первом.
  const firstFloorId = data.scene.floors[0]?.id;
  return {
    floors: data.scene.floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      scene: fromFloorDto(
        floor,
        data.workspaces.filter((workspace) => (workspace.floor_id ?? firstFloorId) === floor.id),
      ),
    })),
  };
}

function fromFloorDto(floor: SceneFloorDto, workspaces: WorkspaceResponse[]): SceneData {
  const nodes: WallNode[] = floor.nodes.map((node) => ({
    id: node.id,
    x: cm(node.x),
    y: cm(node.y),
  }));
  const segments: WallSegment[] = floor.segments.map((segment) => ({
    id: segment.id,
    startNodeId: segment.start_node_id,
    endNodeId: segment.end_node_id,
    thickness: cm(segment.thickness),
  }));
  const rooms: RoomLabel[] = floor.rooms.map((room) => ({
    id: room.id,
    x: cm(room.x),
    y: cm(room.y),
    title: room.title,
    note: room.note,
  }));
  const openings: WallOpening[] = floor.openings.map((opening) => ({
    id: opening.id,
    segmentId: opening.segment_id,
    kind: opening.kind,
    offset: cm(opening.offset),
    width: cm(opening.width),
    height: cm(opening.height),
    sillHeight: cm(opening.sill_height),
    // У окон сервер может не хранить петли — подставляем, чтобы смена вида на дверь не ломала знак.
    hinge: opening.hinge ?? 'start',
    swing: opening.swing ?? 'left',
  }));

  const fixtures: FixtureData[] = (floor.fixtures ?? []).map((fixture) => ({
    ...fixture,
    x: cm(fixture.x),
    y: cm(fixture.y),
    width: cm(fixture.width),
    height: cm(fixture.height),
  }));

  return {
    version: 2,
    nodes,
    segments,
    workspaces: workspaces.map(fromWorkspaceResponse),
    rooms,
    openings,
    fixtures,
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
  if (response.status === 401) {
    return 'нужно войти в систему';
  }
  if (response.status === 403) {
    return 'недостаточно прав — редактировать планы может только администратор ИС';
  }
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
/**
 * Токен входа учётной части (admin.html кладёт сессию в localStorage того же
 * адреса): планы читает любой вошедший, сохраняет — только администратор ИС.
 */
export function sessionToken(): string | null {
  try {
    const raw = localStorage.getItem('arm-monitor.session');
    const token: unknown = raw ? (JSON.parse(raw) as { token?: unknown }).token : null;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

async function fetchFloorPlan(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = sessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(url, { ...init, headers });
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
  plan: PlanData,
  existingId: number | null,
  // Имя открытого плана — иначе PUT молча переименовал бы его в «Мой план».
  name: string = DEFAULT_PLAN_NAME,
): Promise<number> {
  const payload = {
    name,
    width_cm: DEFAULT_SCENE_SIZE_CM,
    height_cm: DEFAULT_SCENE_SIZE_CM,
    background_image_url: null,
    scene: { version: 4, floors: plan.floors.map(toFloorPayload) } satisfies ScenePayload,
    workspaces: plan.floors.flatMap((floor) =>
      floor.scene.workspaces.map((workspace) => toWorkspacePayload(workspace, floor.id)),
    ),
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

/** Загружает план: этажи, у каждого — сцена в формате FloorPlanCanvas (см. showFloor). */
export async function loadFloorPlan(id: number): Promise<PlanData> {
  const response = await fetchFloorPlan(`${API_BASE_URL}/floor-plans/${id}`);
  if (!response.ok) {
    throw new FloorPlanApiError(await buildHttpErrorMessage(response), response.status);
  }

  const data = (await response.json()) as FloorPlanResponse;
  return fromFloorPlanResponse(data);
}
