import { ButtonLink, ChipGroup } from '../../design/components';
import { api } from '../api/client';
import type { FloorPlanSummary, MapConfig, MapTerritory } from '../api/types';
import { can } from '../auth';
import { formatDate, h } from '../ui/dom';
import { errorMessage } from '../ui/toast';
import type { FloorPlanCanvas } from '../../components/FloorPlanCanvas';
import type { TerritoryMap } from '../ui/TerritoryMap';
import type { RouteContext, Screen } from './Screen';

const CONTAINER_ID = 'admin-map-canvas';
// Схемы, ещё не привязанные ни к какой территории, — отдельный пункт списка.
const NO_TERRITORY = 'none';

interface PlanView {
  container: HTMLElement;
  floorChips: HTMLElement;
  status: HTMLElement;
  editorLink: HTMLAnchorElement;
}

/**
 * «Карта»: сначала карта территорий OpenStreetMap со списком (#/map), по
 * выбору территории — её схема без редактирования (#/map?territory=N&plan=M).
 * OpenLayers, Konva и холст плана грузятся динамически — только на этом экране.
 */
export class MapScreen implements Screen {
  readonly title = 'Карта';
  // map-page — карта занимает всю высоту окна под шапкой (см. admin.css).
  readonly element = h('div', { class: 'map-page' });
  private territoryMap: TerritoryMap | null = null;
  private canvas: FloorPlanCanvas | null = null;
  private destroyed = false;

  constructor(context: RouteContext) {
    const territory = context.query.get('territory');
    const plan = Number(context.query.get('plan')) || null;
    if (territory === null && plan === null) void this.showTerritories();
    else void this.showTerritory(territory, plan);
  }

  // ─── Уровень 1: карта территорий ───────────────────────────────

  private async showTerritories(): Promise<void> {
    const status = h('p', { class: 'muted' }, 'Загрузка карты…');
    this.element.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, 'Карта территорий'),
          h('p', { class: 'muted' }, 'Выберите территорию в списке или на карте, чтобы открыть её схему.'),
        ),
        can('edit_floor_plans') ? ButtonLink('Редактор схем', '#/schemas') : null,
      ),
      status,
    );
    try {
      const [{ TerritoryMap }, config, territories, plans] = await Promise.all([
        import('../ui/TerritoryMap'),
        api.get<MapConfig>('/map/config'),
        api.get<MapTerritory[]>('/territories'),
        api.get<FloorPlanSummary[]>('/floor-plans'),
      ]);
      if (this.destroyed) return;
      const loose = plans.filter((plan) => plan.building_id === null);
      this.territoryMap = new TerritoryMap({
        config,
        territories,
        renderDetails: (territory) => this.territoryDetails(territory),
        footer: loose.length
          ? [h('a', { class: 'territory-plan-link', href: `#/map?territory=${NO_TERRITORY}` },
              h('strong', null, 'Схемы без территории'),
              h('span', { class: 'muted t-caption' }, `${loose.length} шт.`))]
          : [],
      });
      status.replaceWith(this.territoryMap.element);
      this.territoryMap.mount();
    } catch (error) {
      status.textContent = `Не удалось загрузить карту: ${errorMessage(error)}`;
    }
  }

  private territoryDetails(territory: MapTerritory): HTMLElement {
    const { plan } = territory;
    if (!plan) return h('p', { class: 'muted t-caption' }, 'Схемы этой территории пока нет.');
    return h('a', { class: 'territory-plan-link', href: `#/map?territory=${territory.building_id}` },
      h('strong', null, 'Открыть схему'),
      plan.description ? h('span', { class: 't-caption' }, plan.description) : null,
      h('span', { class: 'muted t-caption' }, `Рабочих мест: ${plan.workspace_count}`),
    );
  }

  // ─── Уровень 2: схема выбранной территории ─────────────────────

  private async showTerritory(territoryParam: string | null, presetPlanId: number | null): Promise<void> {
    const status = h('span', { class: 'muted small' }, 'Загрузка…');
    const heading = h('h1', null, 'Схема');
    const subtitle = h('p', { class: 'muted' });
    const planChips = h('div');
    const view: PlanView = {
      container: h('div', { id: CONTAINER_ID, class: 'map-wrap' }),
      floorChips: h('div'),
      status,
      editorLink: ButtonLink('Открыть в редакторе', '/index.html'),
    };
    this.element.replaceChildren(
      h('a', { class: 'back', href: '#/map' }, '← Все территории'),
      h('div', { class: 'page-head' },
        h('div', null, heading, subtitle),
        can('edit_floor_plans') ? view.editorLink : null,
      ),
      h('div', { class: 'filters' }, planChips, view.floorChips, status),
      view.container,
    );

    let plans: FloorPlanSummary[];
    let territories: MapTerritory[];
    try {
      [plans, territories] = await Promise.all([
        api.get<FloorPlanSummary[]>('/floor-plans'),
        api.get<MapTerritory[]>('/territories'),
      ]);
    } catch (error) {
      status.textContent = errorMessage(error);
      return;
    }
    if (this.destroyed) return;

    // Ссылка вида #/map?plan=N (из редактора) — территория берётся у самой схемы.
    const preset = plans.find((plan) => plan.id === presetPlanId);
    const buildingId = territoryParam === null
      ? preset?.building_id ?? null
      : territoryParam === NO_TERRITORY ? null : Number(territoryParam);
    const territory = territories.find((t) => t.building_id === buildingId) ?? null;
    if (buildingId !== null && !territory) {
      status.textContent = 'Территория не найдена.';
      return;
    }
    heading.textContent = territory?.name ?? 'Схемы без территории';
    subtitle.textContent = territory?.address ?? 'Схемы, которые ещё не привязаны к зданию на карте.';
    document.title = `${heading.textContent} — АРМ Монитор`;

    const own = plans.filter((plan) => plan.building_id === buildingId);
    if (own.length === 0) {
      status.textContent = '';
      view.container.replaceChildren(h('p', { class: 'table-empty' },
        'У этой территории пока нет схемы. Её создаёт администратор в редакторе схем.'));
      return;
    }
    const initial = own.some((plan) => plan.id === presetPlanId) ? presetPlanId! : own[0].id;
    // У территории одна схема; выбор нужен только среди схем без территории.
    planChips.replaceChildren(
      own.length > 1
        ? new ChipGroup<string>(
            'Схема',
            own.map((plan) => ({ value: String(plan.id), label: plan.name })),
            String(initial),
            (value) => void this.showPlan(Number(value), own, view),
          ).element
        : '',
    );
    await this.showPlan(initial, own, view);
  }

  private async showPlan(planId: number, plans: FloorPlanSummary[], view: PlanView): Promise<void> {
    const { container, floorChips, status, editorLink } = view;
    status.textContent = 'Загрузка плана…';
    editorLink.href = `/index.html?plan=${planId}`;
    try {
      const [{ FloorPlanCanvas }, { loadFloorPlan }] = await Promise.all([
        import('../../components/FloorPlanCanvas'),
        import('../../api/floorPlans'),
      ]);
      const plan = await loadFloorPlan(planId);
      if (this.destroyed) return;

      this.canvas?.destroy();
      container.replaceChildren();
      const canvas = new FloorPlanCanvas(CONTAINER_ID, container.clientWidth, container.clientHeight);
      this.canvas = canvas;
      canvas.setMode('view');
      canvas.showFloor(plan.floors[0].scene);
      canvas.resetView();
      // Вид (масштаб и сдвиг) при смене этажа не сбрасываем: этажи одного
      // здания совпадают в плане, удобно смотреть одно и то же место.
      floorChips.replaceChildren(
        plan.floors.length > 1
          ? new ChipGroup<string>(
              'Этаж',
              plan.floors.map((floor) => ({ value: floor.id, label: floor.name })),
              plan.floors[0].id,
              (floorId) => {
                const floor = plan.floors.find((f) => f.id === floorId);
                if (floor) canvas.showFloor(floor.scene);
              },
            ).element
          : '',
      );
      const desks = plan.floors.reduce((sum, floor) => sum + floor.scene.workspaces.length, 0);
      const updated = plans.find((p) => p.id === planId)?.updated_at;
      status.textContent = `Рабочих мест: ${desks} · изменён ${formatDate(updated)}`;
    } catch (error) {
      status.textContent = `Не удалось загрузить план: ${errorMessage(error)}`;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.territoryMap?.destroy();
    this.territoryMap = null;
    this.canvas?.destroy();
    this.canvas = null;
  }
}
