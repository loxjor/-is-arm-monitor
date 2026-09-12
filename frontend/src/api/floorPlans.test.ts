import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloorPlanApiError, loadFloorPlan, saveFloorPlan } from './floorPlans';
import type { SceneData } from '../types/scene';

const emptyScene: SceneData = { version: 2, nodes: [], segments: [], workspaces: [] };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildHttpErrorMessage (через saveFloorPlan/loadFloorPlan)', () => {
  it('Д-09: 422 с массивом detail даёт понятное сообщение, а не [object Object]', async () => {
    const detail = [
      {
        type: 'greater_than',
        loc: ['body', 'segments', 0, 'thickness'],
        msg: 'Input should be greater than 0',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { detail })),
    );

    await expect(saveFloorPlan(emptyScene, null)).rejects.toMatchObject({
      message: 'сервер отклонил данные плана (body.segments.0.thickness: Input should be greater than 0)',
      status: 422,
    });
  });

  it('Д-10: 404 при открытии — "план не найден", а не сырой текст сервера', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { detail: 'Floor plan not found' })),
    );

    await expect(loadFloorPlan(1)).rejects.toMatchObject({
      message: 'план не найден на сервере',
      status: 404,
    });
  });

  it('Д-10: сетевая ошибка (сервер недоступен) — "сервер недоступен", а не Failed to fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(loadFloorPlan(1)).rejects.toMatchObject({
      message: 'сервер недоступен',
    });
  });

  it('прочие статусы — общее сообщение с кодом', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    await expect(saveFloorPlan(emptyScene, null)).rejects.toMatchObject({
      message: 'ошибка сервера (HTTP 500)',
      status: 500,
    });
  });

  it('422 без detail не падает и не показывает мусор', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, {})));

    await expect(saveFloorPlan(emptyScene, null)).rejects.toMatchObject({
      message: 'сервер отклонил данные плана',
    });
  });

  it('успешный ответ по-прежнему разбирается штатно', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(201, {
          id: 42,
          name: 'Мой план',
          width_cm: 5000,
          height_cm: 5000,
          background_image_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          nodes: [],
          segments: [],
          workspaces: [],
        }),
      ),
    );

    await expect(saveFloorPlan(emptyScene, null)).resolves.toBe(42);
  });
});

describe('loadFloorPlan', () => {
  it('перекладывает серверные id узлов/сегментов в свежие локальные, сохраняя связи', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          id: 7,
          name: 'Мой план',
          width_cm: 5000,
          height_cm: 5000,
          background_image_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          nodes: [
            { id: 101, x: 0, y: 0 },
            { id: 102, x: 100, y: 0 },
          ],
          segments: [{ id: 201, start_node_id: 101, end_node_id: 102, thickness: 10 }],
          workspaces: [],
        }),
      ),
    );

    const scene = await loadFloorPlan(7);

    expect(scene.version).toBe(2);
    expect(scene.nodes).toHaveLength(2);
    expect(scene.segments).toHaveLength(1);
    // id — свежие локальные (не совпадают с серверными числовыми), но
    // ссылки сегмента по-прежнему указывают на реальные узлы из массива.
    const [segment] = scene.segments;
    const nodeIds = new Set(scene.nodes.map((n) => n.id));
    expect(nodeIds.has(segment.startNodeId)).toBe(true);
    expect(nodeIds.has(segment.endNodeId)).toBe(true);
    expect(segment.startNodeId).not.toBe(segment.endNodeId);
  });
});

// Проверяем, что FloorPlanApiError действительно даёт доступ к status —
// main.ts различает 404 именно по нему, а не по тексту сообщения.
it('FloorPlanApiError несёт HTTP-статус', () => {
  const error = new FloorPlanApiError('план не найден на сервере', 404);
  expect(error).toBeInstanceOf(Error);
  expect(error.status).toBe(404);
});
