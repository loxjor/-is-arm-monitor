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
  private readonly select = h('select', { 'aria-label': 'План этажа' });
  private readonly status = h('span', { class: 'muted small' });
  private readonly container = h('div', { id: CONTAINER_ID, class: 'map-wrap' });
  // Ведёт в редактор на тот же план, что открыт здесь (index.html?plan=N).
  private readonly editorLink = h('a', { class: 'btn btn--plain', href: '/index.html', target: '_blank', rel: 'noopener' },
    'Открыть в редакторе');
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
        can('manage_catalogs') ? this.editorLink : null,
      ),
      h('div', { class: 'filters' }, this.select, this.status),
      this.container,
    );
    this.select.addEventListener('change', () => void this.show(Number(this.select.value)));
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
      this.select.hidden = true;
      this.container.replaceChildren(h('p', { class: 'table-empty' },
        'Сохранённых планов пока нет. Их создаёт системный администратор в редакторе карты.'));
      return;
    }
    this.select.append(...plans.map((plan) =>
      h('option', { value: plan.id }, `${plan.name} (изм. ${formatDate(plan.updated_at)})`)));
    const initial = plans.some((p) => p.id === presetId) ? presetId : plans[0].id;
    this.select.value = String(initial);
    await this.show(initial);
  }

  private async show(planId: number): Promise<void> {
    this.status.textContent = 'Загрузка плана…';
    this.editorLink.setAttribute('href', `/index.html?plan=${planId}`);
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
      this.status.textContent = `Стен: ${scene.segments.length}, рабочих мест: ${scene.workspaces.length}`;
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
