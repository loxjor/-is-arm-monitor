import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloorPlanApiError, loadFloorPlan, saveFloorPlan } from './floorPlans';
import type { SceneData } from '../types/scene';
import { cm } from '../utils/scale';

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
          scene: { version: 3, nodes: [], segments: [], openings: [] },
          workspaces: [],
        }),
      ),
    );

    await expect(saveFloorPlan(emptyScene, null)).resolves.toBe(42);
  });
});

describe('saveFloorPlan', () => {
  it('отправляет геометрию документом scene и id рабочих мест как client_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 7,
        name: 'Мой план',
        width_cm: 5000,
        height_cm: 5000,
        background_image_url: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        scene: { version: 3, nodes: [], segments: [], openings: [] },
        workspaces: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const scene: SceneData = {
      version: 2,
      nodes: [
        { id: 'node-a', x: cm(0), y: cm(0) },
        { id: 'node-b', x: cm(100), y: cm(0) },
      ],
      segments: [{ id: 'wall-1', startNodeId: 'node-a', endNodeId: 'node-b', thickness: cm(10) }],
      workspaces: [
        {
          id: 'ws-1',
          x: cm(1),
          y: cm(2),
          width: cm(120),
          height: cm(80),
          rotation: 0,
          label: 'Стол',
          status: 'free',
        },
      ],
    };

    await saveFloorPlan(scene, 7);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/floor-plans\/7$/);
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body.scene).toEqual({
      version: 2,
      nodes: [
        { id: 'node-a', x: 0, y: 0 },
        { id: 'node-b', x: 100, y: 0 },
      ],
      segments: [{ id: 'wall-1', start_node_id: 'node-a', end_node_id: 'node-b', thickness: 10 }],
    });
    expect(body.workspaces[0].client_id).toBe('ws-1');
    expect(body).not.toHaveProperty('nodes');
  });
});

describe('loadFloorPlan', () => {
  it('сохраняет id узлов, сегментов и рабочих мест такими, как их хранит сервер', async () => {
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
          scene: {
            version: 3,
            nodes: [
              { id: 'node-a', x: 0, y: 0 },
              { id: 'node-b', x: 100, y: 0 },
            ],
            segments: [{ id: 'wall-1', start_node_id: 'node-a', end_node_id: 'node-b', thickness: 10 }],
            openings: [],
          },
          workspaces: [
            {
              id: 55,
              client_id: 'ws-1',
              x: 1,
              y: 2,
              width: 120,
              height: 80,
              rotation: 0,
              label: 'Стол',
              status: 'free',
            },
          ],
        }),
      ),
    );

    const scene = await loadFloorPlan(7);

    expect(scene.version).toBe(2);
    expect(scene.nodes.map((n) => n.id)).toEqual(['node-a', 'node-b']);
    expect(scene.segments).toEqual([
      { id: 'wall-1', startNodeId: 'node-a', endNodeId: 'node-b', thickness: 10 },
    ]);
    expect(scene.workspaces[0].id).toBe('ws-1');
  });
});

// Проверяем, что FloorPlanApiError действительно даёт доступ к status —
// main.ts различает 404 именно по нему, а не по тексту сообщения.
it('FloorPlanApiError несёт HTTP-статус', () => {
  const error = new FloorPlanApiError('план не найден на сервере', 404);
  expect(error).toBeInstanceOf(Error);
  expect(error.status).toBe(404);
});
