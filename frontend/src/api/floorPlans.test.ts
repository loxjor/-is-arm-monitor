import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloorPlanApiError, loadFloorPlan, saveFloorPlan } from './floorPlans';
import type { SceneData } from '../types/scene';

const emptyScene: SceneData = { version: 1, walls: [], workspaces: [] };

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
        loc: ['body', 'walls', 0, 'length'],
        msg: 'Input should be greater than 0',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { detail })),
    );

    await expect(saveFloorPlan(emptyScene, null)).rejects.toMatchObject({
      message: 'сервер отклонил данные плана (body.walls.0.length: Input should be greater than 0)',
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
          walls: [],
          workspaces: [],
        }),
      ),
    );

    await expect(saveFloorPlan(emptyScene, null)).resolves.toBe(42);
  });
});

// Проверяем, что FloorPlanApiError действительно даёт доступ к status —
// main.ts различает 404 именно по нему, а не по тексту сообщения.
it('FloorPlanApiError несёт HTTP-статус', () => {
  const error = new FloorPlanApiError('план не найден на сервере', 404);
  expect(error).toBeInstanceOf(Error);
  expect(error.status).toBe(404);
});
