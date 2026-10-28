import 'ol/ol.css';
import OlMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import View from 'ol/View';
import { defaults as defaultControls } from 'ol/control/defaults';
import { boundingExtent } from 'ol/extent';
import TileLayer from 'ol/layer/Tile';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import XYZ from 'ol/source/XYZ';
import type { MapConfig, MapTerritory } from '../api/types';
import { currentTheme, onThemeChange } from '../../theme';
import { h } from './dom';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface TerritoryMapOptions {
  config: MapConfig;
  territories: MapTerritory[];
  /** Кнопки над поиском (например, «Добавить территорию»). */
  actions?: HTMLElement[];
  /** Пункты в конце списка (например, «Схемы без территории»). */
  footer?: HTMLElement[];
  /** Что показать в раскрытой карточке выбранной территории. */
  renderDetails: (territory: MapTerritory) => HTMLElement;
  selectedId?: number | null;
}

// Масштаб, на котором видно отдельный дом.
const HOUSE_ZOOM = 17;

type Located = MapTerritory & { latitude: number; longitude: number };

function hasPoint(territory: MapTerritory): territory is Located {
  return territory.latitude !== null && territory.longitude !== null;
}

/**
 * Карта территорий OpenStreetMap (OpenLayers) со списком слева — как поиск
 * в Яндекс Картах: строка поиска, список, по клику — точка на карте и
 * карточка с её схемами. Тайлы берутся с сервера из настроек бэкенда
 * (MAP_TILE_URL), поэтому в закрытой сети работает со своим сервером тайлов.
 */
export class TerritoryMap {
  readonly element: HTMLElement;
  private readonly map: OlMap;
  private readonly mapHost = h('div', { class: 'territory-map' });
  private readonly search = h('input', { type: 'search', class: 'search', placeholder: 'Поиск территории или адреса' });
  private readonly list = h('div', { class: 'territory-list', role: 'list' });
  private readonly listView: HTMLElement;
  private readonly panel = h('div', { class: 'territory-panel' });
  private readonly pins = new Map<number, Overlay>();
  private readonly draft: Overlay;
  private territories: MapTerritory[];
  private selectedId: number | null;
  private clickHandler: ((point: LatLon) => void) | null = null;
  private readonly bounds: MapConfig['bounds'];
  private readonly unsubscribeTheme: () => void;

  constructor(private readonly options: TerritoryMapOptions) {
    this.territories = options.territories;
    this.selectedId = options.selectedId ?? null;
    this.listView = h('div', { class: 'territory-list-view' },
      options.actions?.length ? h('div', { class: 'territory-actions' }, options.actions) : null,
      this.search,
      this.list,
    );
    this.panel.append(this.listView);
    this.element = h('div', { class: 'territory-explorer' }, this.panel, this.mapHost);
    this.search.addEventListener('input', () => this.renderList());

    const { config } = options;
    // Регион карты (Москва и область): тайлы за ним не запрашиваются, а вид
    // не прокручивается и не отдаляется дальше него.
    const region = transformExtent(config.bounds, 'EPSG:4326', 'EPSG:3857');
    this.bounds = config.bounds;
    // Без target: карта привязывается к элементу в mount(), уже с нужным видом.
    // Иначе первый кадр успевал запросить тайлы обзорного масштаба, и нужные
    // тайлы дома ждали своей очереди — карта прогружалась кусками.
    this.map = new OlMap({
      controls: defaultControls({ rotate: false, attributionOptions: { collapsible: false } }),
      layers: [
        new TileLayer({
          source: new XYZ({ url: config.tile_url, attributions: config.attribution, maxZoom: config.max_zoom }),
          extent: region,
          // Пока грузятся тайлы текущего масштаба, дыры закрывают размытые
          // тайлы двух масштабов крупнее — без белых пятен при приближении.
          preload: 2,
        }),
      ],
      view: new View({
        center: fromLonLat([config.center[1], config.center[0]]),
        zoom: config.zoom,
        maxZoom: config.max_zoom,
        extent: region,
        constrainOnlyCenter: false,
      }),
    });
    this.map.on('click', (event) => {
      if (!this.clickHandler) return;
      const [longitude, latitude] = toLonLat(event.coordinate);
      // Край тайла может выглядывать за регион — точку там не ставим.
      if (this.inBounds({ latitude, longitude })) this.clickHandler({ latitude, longitude });
    });

    this.draft = new Overlay({
      element: h('div', { class: 'territory-pin territory-pin--draft', title: 'Перетащите точку на нужный дом' }, h('span', null, 'Новая точка')),
      positioning: 'bottom-center',
      stopEvent: true,
    });
    this.map.addOverlay(this.draft);

    // Тёмная тема — те же тайлы, приглушённые фильтром (см. admin.css).
    const applyTheme = () => this.mapHost.classList.toggle('territory-map--dark', currentTheme() === 'dark');
    applyTheme();
    this.unsubscribeTheme = onThemeChange(applyTheme);

    this.renderPins();
    this.renderList();
  }

  /** Вызывается, когда элемент уже в документе: карте нужен его размер. */
  mount(): void {
    this.map.setTarget(this.mapHost);
    this.map.updateSize();
    // Вид ставится до первого кадра (он рисуется в следующем requestAnimationFrame).
    const selected = this.territories.find((t) => t.building_id === this.selectedId);
    if (selected && hasPoint(selected)) this.centerOn(selected, HOUSE_ZOOM);
    else this.fitAll();
  }

  setTerritories(territories: MapTerritory[]): void {
    this.territories = territories;
    this.renderPins();
    this.renderList();
  }

  select(id: number | null, fly = true): void {
    this.selectedId = id;
    for (const [pinId, pin] of this.pins) pin.getElement()?.classList.toggle('active', pinId === id);
    this.renderList();
    const territory = this.territories.find((t) => t.building_id === id);
    if (fly && territory && hasPoint(territory)) this.flyTo(territory, Math.max(this.map.getView().getZoom() ?? 0, 16));
  }

  /** Подменяет список формой (добавление и правка территории); null — вернуть список. */
  showPanel(content: HTMLElement | null): void {
    this.panel.replaceChildren(content ?? this.listView);
  }

  /** Режим «поставьте точку на доме»: клик по карте отдаёт координаты. */
  onMapClick(handler: ((point: LatLon) => void) | null): void {
    this.clickHandler = handler;
    this.mapHost.classList.toggle('territory-map--picking', handler !== null);
  }

  /** Точка будущей (или перемещаемой) территории; её можно перетащить. */
  setDraft(point: LatLon | null, onMove?: (point: LatLon) => void): void {
    if (!point) {
      this.draft.setPosition(undefined);
      return;
    }
    this.draft.setPosition(fromLonLat([point.longitude, point.latitude]));
    const element = this.draft.getElement()!;
    element.onpointerdown = (down) => {
      down.preventDefault();
      element.setPointerCapture(down.pointerId);
      const move = (event: PointerEvent) => this.draft.setPosition(this.map.getEventCoordinate(event));
      const up = (event: PointerEvent) => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', up);
        const [longitude, latitude] = toLonLat(this.map.getEventCoordinate(event));
        onMove?.({ latitude, longitude });
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', up);
    };
  }

  /** Скрыть точку территории на время её перемещения (видна только черновая). */
  hidePin(id: number | null): void {
    for (const [pinId, pin] of this.pins) pin.getElement()!.hidden = pinId === id;
  }

  flyTo(point: LatLon, zoom = HOUSE_ZOOM, duration = 400): void {
    this.map.getView().animate({ center: fromLonLat([point.longitude, point.latitude]), zoom, duration });
  }

  destroy(): void {
    this.unsubscribeTheme();
    this.map.setTarget(undefined);
  }

  inBounds(point: LatLon): boolean {
    const [west, south, east, north] = this.bounds;
    return point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north;
  }

  private centerOn(point: LatLon, zoom: number): void {
    const view = this.map.getView();
    view.setCenter(fromLonLat([point.longitude, point.latitude]));
    view.setZoom(zoom);
  }

  private fitAll(): void {
    const located = this.territories.filter(hasPoint);
    if (located.length === 1) this.centerOn(located[0], 16);
    if (located.length < 2) return;
    const extent = boundingExtent(located.map((t) => fromLonLat([t.longitude, t.latitude])));
    this.map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 16 });
  }

  private renderPins(): void {
    for (const pin of this.pins.values()) this.map.removeOverlay(pin);
    this.pins.clear();
    for (const territory of this.territories.filter(hasPoint)) {
      const element = h('button', {
        type: 'button',
        class: `territory-pin${territory.building_id === this.selectedId ? ' active' : ''}`,
        title: territory.address,
        onclick: () => this.select(territory.building_id),
      }, h('span', null, territory.name));
      const pin = new Overlay({
        element,
        position: fromLonLat([territory.longitude, territory.latitude]),
        positioning: 'bottom-center',
        stopEvent: true,
      });
      this.map.addOverlay(pin);
      this.pins.set(territory.building_id, pin);
    }
  }

  private renderList(): void {
    const wanted = this.search.value.trim().toLowerCase();
    const shown = this.territories.filter((t) => !wanted || `${t.name} ${t.address}`.toLowerCase().includes(wanted));
    const items = shown.map((territory) => {
      const selected = territory.building_id === this.selectedId;
      return h('div', { class: `territory-item${selected ? ' active' : ''}`, role: 'listitem' },
        h('button', {
          type: 'button',
          class: 'territory-item-head',
          'aria-expanded': String(selected),
          onclick: () => this.select(selected ? null : territory.building_id),
        },
          h('span', { class: 't-heading' }, territory.name),
          h('span', { class: 'muted t-caption' }, territory.address),
          h('span', { class: 'territory-item-meta' },
            h('span', { class: 'tag' }, territory.plan ? 'есть схема' : 'нет схемы'),
            hasPoint(territory) ? null : h('span', { class: 'muted t-caption' }, 'нет на карте'),
          ),
        ),
        selected ? h('div', { class: 'territory-item-body' }, this.options.renderDetails(territory)) : null,
      );
    });
    this.list.replaceChildren(
      ...(items.length ? items : [h('p', { class: 'muted territory-empty' }, wanted ? 'Ничего не найдено.' : 'Территорий пока нет.')]),
      ...(this.options.footer ?? []),
    );
  }
}
