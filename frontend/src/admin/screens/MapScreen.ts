import { ButtonLink, ChipGroup } from '../../design/components';
import { api } from '../api/client';
import type { FloorPlanSummary } from '../api/types';
import { can } from '../auth';
import { formatDate, h } from '../ui/dom';
import { errorMessage } from '../ui/toast';
import type { FloorPlanCanvas } from '../../components/FloorPlanCanvas';
import type { RouteContext, Screen } from './Screen';

const CONTAINER_ID = 'admin-map-canvas';

/**
 * Просмотр плана этажа без редактирования. Холст карты и Konva грузятся
 * динамически — только когда открыт этот экран, остальные страницы их не тянут.
 */
export class MapScreen implements Screen {
  readonly title = 'Карта этажа';
  readonly element: HTMLElement;
  private readonly planChips = h('div');
  private readonly status = h('span', { class: 'muted small' });
  private readonly container = h('div', { id: CONTAINER_ID, class: 'map-wrap' });
  // Ведёт в редактор на тот же план, что открыт здесь (index.html?plan=N).
  private readonly editorLink = ButtonLink('Открыть в редакторе', '/index.html');
  private canvas: FloorPlanCanvas | null = null;
  private destroyed = false;

  constructor(context: RouteContext) {
    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, this.title),
          h('p', { class: 'muted' }, 'Колесо мыши — масштаб, перетаскивание — перемещение по плану.'),
        ),
        can('edit_floor_plans') ? this.editorLink : null,
      ),
      h('div', { class: 'filters' }, this.planChips, this.status),
      this.container,
    );
    void this.init(Number(context.query.get('plan')));
  }

  private async init(presetId: number): Promise<void> {
    let plans: FloorPlanSummary[];
    try {
      plans = await api.get<FloorPlanSummary[]>('/floor-plans');
    } catch (error) {
      this.status.textContent = errorMessage(error);
      return;
    }
    if (this.destroyed) return;
    if (plans.length === 0) {
      this.container.replaceChildren(h('p', { class: 'table-empty' },
        'Сохранённых планов пока нет. Их создаёт системный администратор в редакторе карты.'));
      return;
    }
    const initial = plans.some((p) => p.id === presetId) ? presetId : plans[0].id;
    const chips = new ChipGroup<string>(
      'План этажа',
      plans.map((plan) => ({ value: String(plan.id), label: plan.name })),
      String(initial),
      (value) => void this.show(Number(value)),
    );
    this.planChips.replaceChildren(chips.element);
    await this.show(initial, plans);
  }

  private plans: FloorPlanSummary[] = [];

  private async show(planId: number, plans?: FloorPlanSummary[]): Promise<void> {
    if (plans) this.plans = plans;
    this.status.textContent = 'Загрузка плана…';
    this.editorLink.href = `/index.html?plan=${planId}`;
    try {
      const [{ FloorPlanCanvas }, { loadFloorPlan }] = await Promise.all([
        import('../../components/FloorPlanCanvas'),
        import('../../api/floorPlans'),
      ]);
      const scene = await loadFloorPlan(planId);
      if (this.destroyed) return;

      this.canvas?.destroy();
      this.container.replaceChildren();
      this.canvas = new FloorPlanCanvas(CONTAINER_ID, this.container.clientWidth, this.container.clientHeight);
      this.canvas.setMode('view');
      this.canvas.loadScene(scene);
      this.canvas.resetView();
      const updated = this.plans.find((p) => p.id === planId)?.updated_at;
      this.status.textContent = `Рабочих мест: ${scene.workspaces.length} · изменён ${formatDate(updated)}`;
    } catch (error) {
      this.status.textContent = `Не удалось загрузить план: ${errorMessage(error)}`;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas?.destroy();
    this.canvas = null;
  }
}
