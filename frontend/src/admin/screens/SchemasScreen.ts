import { Button, ButtonLink } from '../../design/components';
import { ApiError, api, download } from '../api/client';
import type { FloorPlanSummary, GeocodeResult, MapConfig, MapTerritory, Scalar, TerritoryPlan } from '../api/types';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal, confirmDialog } from '../ui/Modal';
import { formatDate, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { LatLon, TerritoryMap } from '../ui/TerritoryMap';
import type { RouteContext, Screen } from './Screen';

// Схемы, ещё не привязанные ни к какой территории, — отдельная страница.
const NO_TERRITORY = 'none';

/** Пустой план из одного этажа — тот же, с которого начинает редактор. */
function emptyPlanPayload(values: Record<string, Scalar>) {
  return {
    ...values,
    width_cm: 5000,
    height_cm: 5000,
    background_image_url: null,
    scene: {
      version: 4,
      floors: [{ id: `floor-${Date.now()}`, name: '1-й этаж', fixtures: [], nodes: [], segments: [], openings: [], rooms: [] }],
    },
    workspaces: [],
  };
}

function desksText(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} рабочих мест`;
  if (ones === 1) return `${count} рабочее место`;
  if (ones >= 2 && ones <= 4) return `${count} рабочих места`;
  return `${count} рабочих мест`;
}

function formatPoint(point: LatLon): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/**
 * «Редактор схем»: карта территорий OpenStreetMap. Территорию ставят точкой
 * на доме (адрес подставляется сам) или находят по адресу (точка ставится
 * сама). У территории одна схема, названная так же, — её создают, описывают
 * и открывают в редакторе плана прямо из карточки территории.
 */
export class SchemasScreen implements Screen {
  readonly title = 'Редактор схем';
  readonly element = h('div');
  private territoryMap: TerritoryMap | null = null;
  private config: MapConfig | null = null;
  private territories: MapTerritory[] = [];
  private plans: FloorPlanSummary[] = [];
  private destroyed = false;

  constructor(context: RouteContext) {
    // У территории одна схема — она открывается прямо из карточки на карте;
    // отдельная страница нужна только схемам, ещё не привязанным к территории.
    const territory = context.query.get('territory');
    if (territory === NO_TERRITORY) void this.showLoosePlans();
    else void this.showTerritories(Number(territory ?? context.query.get('selected')) || null);
  }

  private async loadData(): Promise<void> {
    [this.territories, this.plans] = await Promise.all([
      api.get<MapTerritory[]>('/territories'),
      api.get<FloorPlanSummary[]>('/floor-plans'),
    ]);
  }

  // ─── Уровень 1: территории на карте ────────────────────────────

  private async showTerritories(selected: number | null): Promise<void> {
    const status = h('p', { class: 'muted' }, 'Загрузка карты…');
    // Карта занимает всю высоту окна под шапкой (см. .map-page в admin.css).
    this.element.classList.add('map-page');
    this.element.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, this.title),
          h('p', { class: 'muted' }, 'Территории на карте и их схемы. Выберите территорию, чтобы создать или открыть её схему.'),
        ),
        ButtonLink('Просмотр карты', '#/map'),
      ),
      status,
    );
    try {
      const [{ TerritoryMap }, config] = await Promise.all([
        import('../ui/TerritoryMap'),
        api.get<MapConfig>('/map/config'),
        this.loadData(),
      ]);
      if (this.destroyed) return;
      this.config = config;
      const loose = this.plans.filter((plan) => plan.building_id === null).length;
      this.territoryMap = new TerritoryMap({
        config,
        territories: this.territories,
        selectedId: selected,
        actions: [
          Button('Добавить территорию', { onClick: () => this.openTerritoryForm(null) }),
          Button('Импорт схемы', { variant: 'light', onClick: () => this.importPlan() }),
        ],
        renderDetails: (territory) => this.territoryDetails(territory),
        footer: loose
          ? [h('a', { class: 'territory-plan-link', href: `#/schemas?territory=${NO_TERRITORY}` },
              h('strong', null, 'Схемы без территории'),
              h('span', { class: 'muted t-caption' }, `${loose} шт. — привяжите их к зданию`))]
          : [],
      });
      status.replaceWith(this.territoryMap.element);
      this.territoryMap.mount();
    } catch (error) {
      status.textContent = `Не удалось загрузить карту: ${errorMessage(error)}`;
    }
  }

  /** Карточка территории: её схема (одна, называется как территория) и действия с ней. */
  private territoryDetails(territory: MapTerritory): HTMLElement {
    const { plan } = territory;
    const editTerritory = Button('Изменить территорию', { variant: 'light', onClick: () => this.openTerritoryForm(territory) });
    if (!plan) {
      return h('div', { class: 'territory-item-body' },
        h('p', { class: 'muted t-caption' }, 'Схемы пока нет.'),
        h('div', { class: 'territory-actions' },
          Button('Создать схему', { onClick: () => void this.createPlan(territory) }),
          editTerritory,
        ),
      );
    }
    return h('div', { class: 'territory-item-body' },
      h('a', { class: 'territory-plan-link', href: `/index.html?plan=${plan.id}`, title: 'Открыть в редакторе плана' },
        h('strong', null, 'Открыть схему в редакторе'),
        plan.description ? h('span', { class: 't-caption' }, plan.description) : null,
        h('span', { class: 'muted t-caption' }, `${desksText(plan.workspace_count)} · изменена ${formatDate(plan.updated_at)}`),
      ),
      h('div', { class: 'territory-actions' },
        ButtonLink('Просмотр', `#/map?territory=${territory.building_id}`),
        Button('Описание', { variant: 'light', onClick: () => this.openDescription(territory, plan) }),
        Button('Экспорт', { variant: 'light', onClick: () => void this.exportPlan(plan) }),
        editTerritory,
        Button('Удалить схему', { variant: 'light', onClick: () => void this.removeTerritoryPlan(territory, plan) }),
      ),
    );
  }

  /** Новая схема территории — пустой план без названия (оно — имя территории), сразу в редактор. */
  private async createPlan(territory: MapTerritory): Promise<void> {
    try {
      const plan = await api.post<{ id: number }>('/floor-plans', emptyPlanPayload({ building_id: territory.building_id }));
      location.href = `/index.html?plan=${plan.id}`;
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  private openDescription(territory: MapTerritory, plan: TerritoryPlan): void {
    const fields: FieldSpec[] = [{ name: 'description', label: 'Описание схемы', kind: 'textarea', maxLength: 2000 }];
    this.openForm(`Схема «${territory.name}»`, fields, { description: plan.description }, 'Сохранить', async (values) => {
      await api.patch(`/floor-plans/${plan.id}`, values);
      toast('Описание сохранено');
      await this.refreshMap(territory.building_id);
    });
  }

  private async removeTerritoryPlan(territory: MapTerritory, plan: TerritoryPlan): Promise<void> {
    const confirmed = await confirmDialog(
      'Удалить схему?',
      `Схема территории «${territory.name}» со всеми этажами и рабочими местами (${plan.workspace_count}) будет удалена без возможности восстановления. Сама территория останется.`,
      'Удалить',
    );
    if (!confirmed) return;
    try {
      await api.delete(`/floor-plans/${plan.id}`);
      toast('Схема удалена');
      await this.refreshMap(territory.building_id);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  private async refreshMap(selected: number | null): Promise<void> {
    await this.loadData();
    this.territoryMap?.setTerritories(this.territories);
    this.territoryMap?.select(selected, false);
  }

  /**
   * Добавление и правка территории — в панели слева, карта остаётся
   * доступной: клик по дому ставит точку и подставляет адрес, «Найти» по
   * введённому адресу ставит точку сама. Точку можно перетащить.
   */
  private openTerritoryForm(territory: MapTerritory | null): void {
    const map = this.territoryMap;
    if (!map || !this.config) return;
    const geocoder = this.config.geocoder;
    let point: LatLon | null = territory?.latitude != null && territory.longitude != null
      ? { latitude: territory.latitude, longitude: territory.longitude }
      : null;
    // Адрес, который набрали руками, клик по карте не перетирает.
    let addressTouched = false;

    const fields: FieldSpec[] = [
      { name: 'name', label: 'Название', kind: 'text', required: true, maxLength: 50, placeholder: 'Например, Главное здание' },
      { name: 'address', label: 'Адрес', kind: 'text', required: true, maxLength: 255 },
      { name: 'floors_count', label: 'Этажей в здании', kind: 'integer', min: 0, max: 200 },
    ];
    const form = new Form(fields, territory
      ? { name: territory.name, address: territory.address, floors_count: territory.floors_count }
      : {});
    const addressInput = form.element.querySelector<HTMLInputElement>('[name="address"]')!;
    const pointStatus = h('div', { class: 'point-status t-caption' });
    const results = h('ul', { class: 'geocode-results' });

    const refreshPoint = () => {
      pointStatus.textContent = point
        ? `Точка: ${formatPoint(point)}. Перетащите её, если она не на том доме.`
        : geocoder
          ? 'Кликните по дому на карте или найдите адрес.'
          : 'Кликните по дому на карте.';
    };
    const setPoint = (next: LatLon, fly: boolean) => {
      point = next;
      map.setDraft(next, (moved) => void placed(moved, false));
      if (fly) map.flyTo(next);
      refreshPoint();
    };
    // Точку поставили на карте — адрес дома под ней подставляет геокодер.
    const placed = async (next: LatLon, fly: boolean) => {
      setPoint(next, fly);
      if (!geocoder || addressTouched) return;
      try {
        const found = await api.get<GeocodeResult | null>('/geocode/reverse', { lat: next.latitude, lon: next.longitude });
        if (found?.address && !addressTouched) form.setValues({ address: found.address });
      } catch {
        // без геокодера адрес вводится руками
      }
    };
    const find = async () => {
      const text = addressInput.value.trim();
      if (text.length < 3) {
        form.setFieldError('address', 'введите адрес');
        return;
      }
      results.replaceChildren(h('li', { class: 'muted t-caption' }, 'Поиск…'));
      try {
        const found = await api.get<GeocodeResult[]>('/geocode/search', { q: text });
        if (found.length === 0) {
          results.replaceChildren(h('li', { class: 'muted t-caption' }, 'Адрес не найден — поставьте точку на карте.'));
          return;
        }
        const choose = (result: GeocodeResult) => {
          results.replaceChildren();
          setPoint(result, true);
        };
        if (found.length === 1) {
          choose(found[0]);
          return;
        }
        results.replaceChildren(...found.map((result) =>
          h('li', null, h('button', { type: 'button', onclick: () => choose(result) }, result.address))));
      } catch (error) {
        results.replaceChildren(h('li', { class: 'muted t-caption' }, errorMessage(error)));
      }
    };

    addressInput.addEventListener('input', () => {
      addressTouched = true;
    });
    addressInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && geocoder) {
        event.preventDefault();
        void find();
      }
    });

    const close = () => {
      map.onMapClick(null);
      map.setDraft(null);
      map.hidePin(null);
      map.showPanel(null);
    };
    const save = async () => {
      const values = form.getValues();
      if (!values) return;
      const body = { ...values, latitude: point?.latitude ?? null, longitude: point?.longitude ?? null };
      try {
        const saved = territory
          ? await api.patch<MapTerritory>(`/territories/${territory.building_id}`, body)
          : await api.post<MapTerritory>('/territories', body);
        toast(territory ? 'Территория сохранена' : 'Территория добавлена');
        close();
        await this.loadData();
        map.setTerritories(this.territories);
        map.select(saved.building_id);
      } catch (error) {
        if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
        else form.showError('Не удалось сохранить');
      }
    };

    map.showPanel(h('div', { class: 'territory-form' },
      h('h2', { class: 't-heading' }, territory ? `Территория «${territory.name}»` : 'Новая территория'),
      form.element,
      geocoder ? Button('Найти адрес на карте', { variant: 'light', onClick: () => void find() }) : null,
      results,
      pointStatus,
      h('div', { class: 'territory-actions' },
        Button('Сохранить', { onClick: () => void save() }),
        Button('Отмена', { variant: 'light', onClick: close }),
        point ? Button('Убрать с карты', {
          variant: 'light',
          onClick: () => {
            point = null;
            map.setDraft(null);
            refreshPoint();
          },
        }) : null,
      ),
    ));
    map.onMapClick((next) => void placed(next, false));
    map.hidePin(territory?.building_id ?? null);
    if (point) setPoint(point, true);
    else refreshPoint();
    void form.ready.then(() => form.focusFirst());
  }

  // ─── Схемы без территории ──────────────────────────────────────

  /**
   * Схемы, сохранённые до территорий (или отвязанные от здания). Только у
   * них своё название; привязав к территории, схема получает её имя.
   */
  private async showLoosePlans(): Promise<void> {
    const cards = h('div', { class: 'schema-cards' }, h('p', { class: 'muted' }, 'Загрузка…'));
    this.element.classList.remove('map-page');
    this.element.replaceChildren(
      h('a', { class: 'back', href: '#/schemas' }, '← Все территории'),
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, 'Схемы без территории'),
          h('p', { class: 'muted' }, 'Привяжите схему к территории в «Свойствах» — она получит имя территории и появится на карте.'),
        ),
        Button('Импорт схемы', { variant: 'light', onClick: () => this.importPlan() }),
      ),
      cards,
    );
    try {
      await this.loadData();
    } catch (error) {
      cards.replaceChildren(h('p', { class: 'table-empty' }, errorMessage(error)));
      return;
    }
    if (this.destroyed) return;
    const loose = this.plans.filter((plan) => plan.building_id === null);
    cards.replaceChildren(...(loose.length
      ? loose.map((plan) => this.looseCard(plan))
      : [h('p', { class: 'table-empty' }, 'Все схемы привязаны к территориям.')]));
  }

  private looseCard(plan: FloorPlanSummary): HTMLElement {
    return h('article', { class: 'schema-card' },
      h('a', { class: 'schema-card-main', href: `/index.html?plan=${plan.id}`, title: 'Открыть в редакторе плана' },
        h('strong', { class: 't-heading' }, plan.name),
        h('span', { class: plan.description ? 'schema-card-desc' : 'schema-card-desc muted' }, plan.description ?? 'Без описания'),
        h('span', { class: 'muted t-caption' }, `${desksText(plan.workspace_count)} · изменена ${formatDate(plan.updated_at)}`),
      ),
      h('div', { class: 'schema-card-actions' },
        ButtonLink('Просмотр', `#/map?territory=${NO_TERRITORY}&plan=${plan.id}`),
        Button('Свойства', { variant: 'light', onClick: () => this.openLooseEdit(plan) }),
        Button('Экспорт', { variant: 'light', onClick: () => void this.exportPlan(plan) }),
        Button('Удалить', { variant: 'light', onClick: () => void this.removeLoose(plan) }),
      ),
    );
  }

  private openLooseEdit(plan: FloorPlanSummary): void {
    // Привязать можно только к территории, у которой ещё нет схемы.
    const free = this.territories.filter((t) => !t.plan);
    const fields: FieldSpec[] = [
      {
        name: 'building_id',
        label: 'Территория',
        kind: 'select',
        hint: 'Схема получит имя территории. В списке — территории без схемы.',
        options: () => Promise.resolve(free.map((t) => ({ value: t.building_id, label: `${t.name} — ${t.address}` }))),
      },
      {
        name: 'name',
        label: 'Название',
        kind: 'text',
        required: true,
        maxLength: 255,
        visible: (values) => values.building_id === null,
      },
      { name: 'description', label: 'Описание', kind: 'textarea', maxLength: 2000 },
    ];
    this.openForm(plan.name, fields, { name: plan.name, building_id: null, description: plan.description }, 'Сохранить', async (values) => {
      // Привязанная схема называется как территория — своё название не шлём.
      const body = values.building_id === null ? values : { building_id: values.building_id, description: values.description };
      await api.patch(`/floor-plans/${plan.id}`, body);
      toast(values.building_id === null ? 'Схема сохранена' : 'Схема привязана к территории');
      await this.showLoosePlans();
    });
  }

  private async removeLoose(plan: FloorPlanSummary): Promise<void> {
    const confirmed = await confirmDialog(
      'Удалить схему?',
      `Схема «${plan.name}» и все её рабочие места (${plan.workspace_count}) будут удалены без возможности восстановления.`,
      'Удалить',
    );
    if (!confirmed) return;
    try {
      await api.delete(`/floor-plans/${plan.id}`);
      toast('Схема удалена');
      await this.showLoosePlans();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  // ─── Экспорт и импорт схем ────────────────────────────────────

  private async exportPlan(plan: { id: number }): Promise<void> {
    try {
      await download(`/floor-plans/${plan.id}/export`, `схема-${plan.id}.json`);
      toast('Схема выгружена');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  private importPlan(): void {
    const input = h('input', { type: 'file', accept: 'application/json,.json' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.readImportFile(file);
    });
    input.click();
  }

  private async readImportFile(file: File): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('Файл не является JSON-схемой', 'error');
      return;
    }
    try {
      const created = await api.post<{ name: string }>('/floor-plans/import', data);
      toast(`Схема «${created.name}» импортирована`);
      // Импортированная схема не привязана к территории — показываем её среди «схем без территории».
      await this.showLoosePlans();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  private openForm(
    title: string,
    fields: FieldSpec[],
    initial: Record<string, Scalar>,
    submitLabel: string,
    submit: (values: Record<string, Scalar>) => Promise<void>,
  ): void {
    const form = new Form(fields, initial);
    new Modal(title, form.element, [
      { label: 'Отмена', onClick: () => undefined },
      {
        label: submitLabel,
        kind: 'primary',
        onClick: async () => {
          const values = form.getValues();
          if (!values) return false;
          try {
            await submit(values);
            return true;
          } catch (error) {
            if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
            else form.showError('Не удалось сохранить');
            return false;
          }
        },
      },
    ]).open();
    void form.ready.then(() => form.focusFirst());
  }

  destroy(): void {
    this.destroyed = true;
    this.territoryMap?.destroy();
    this.territoryMap = null;
  }
}
