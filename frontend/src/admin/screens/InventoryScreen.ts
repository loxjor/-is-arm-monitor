import { Button } from '../../design/components';
import { api } from '../api/client';
import type {
  InventoryDetail,
  InventoryItem,
  InventoryRecord,
  InventoryRoom,
  InventoryTerritory,
  Page,
} from '../api/types';
import { DataTable, Pager } from '../ui/DataTable';
import { dash, formatDate, h } from '../ui/dom';
import { Modal } from '../ui/Modal';
import { errorMessage, toast } from '../ui/toast';
import type { RouteContext, Screen } from './Screen';

const PAGE_SIZE = 50;

type InvState = 'empty' | 'present' | 'missing';

const STATE_LABELS: Record<InvState, string> = {
  empty: 'не проверено',
  present: 'в наличии',
  missing: 'не найден',
};

function stateOf(item: InventoryItem): InvState {
  if (!item.checked) return 'empty';
  return item.is_present ? 'present' : 'missing';
}

function statusCell(item: InventoryItem): HTMLElement {
  if (!item.checked) return h('span', { class: 'muted' }, 'Не проверено');
  if (item.is_present) return h('span', { class: 'tag tag--accent' }, 'В наличии');
  return h('span', { class: 'tag tag--danger' }, 'Не найден');
}

function inventoryStatusBadge(status: InventoryRecord['status']): HTMLElement {
  return status === 'open'
    ? h('span', { class: 'tag tag--accent' }, 'Открыта')
    : h('span', { class: 'tag' }, 'Завершена');
}

/** Инвентаризация: история, запуск, ручная сверка чекбоксами и отметка сканером. */
export class InventoryScreen implements Screen {
  readonly title = 'Инвентаризация';
  readonly element: HTMLElement;
  private detail: InventoryDetail | null = null;
  private tableBody: HTMLTableSectionElement | null = null;
  private cardsEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private scanInput: HTMLInputElement | null = null;
  private camera: { video: HTMLVideoElement; stop: () => void } | null = null;

  constructor(context: RouteContext) {
    this.element = h('div', null);
    const id = context.params[0] ? Number(context.params[0]) : null;
    void (id ? this.showDetail(id) : this.showHistory());
  }

  destroy(): void {
    this.camera?.stop();
  }

  // ── История ──────────────────────────────────────────────────

  private async showHistory(): Promise<void> {
    this.detail = null;
    const table = new DataTable<InventoryRecord>(
      [
        { title: '№', render: (row) => h('strong', null, `№ ${row.inventory_id}`) },
        { title: 'Дата начала', render: (row) => formatDate(row.started_on) },
        {
          title: 'Территория / Кабинет',
          render: (row) => h('div', null, dash(row.building_name), row.room_no ? h('div', { class: 'muted small' }, `каб. ${row.room_no}`) : null),
        },
        { title: 'Основание', render: (row) => h('span', { class: 'clip' }, row.basis) },
        { title: 'Ответственный', render: (row) => dash(row.responsible_name) },
        { title: 'Статус', render: (row) => inventoryStatusBadge(row.status) },
        {
          title: 'Результат',
          render: (row) => h('div', null, `${row.present_count} из ${row.total_count}`, h('div', { class: 'muted small' }, `проверено ${row.checked_count}`)),
        },
      ],
      { onRowClick: (row) => (location.hash = `#/inventory/${row.inventory_id}`), emptyText: 'Инвентаризаций ещё не было' },
    );
    const pager = new Pager(PAGE_SIZE, () => void this.loadHistory(table, pager));

    this.element.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, this.title),
          h('p', { class: 'muted' }, 'Сверка техники на подконтрольных территориях: вручную по чек-листу или сканером QR-кода'),
        ),
        Button('Начать инвентаризацию', { onClick: () => this.openStartModal() }),
      ),
      table.element,
      pager.element,
    );
    await this.loadHistory(table, pager);
  }

  private async loadHistory(table: DataTable<InventoryRecord>, pager: Pager): Promise<void> {
    table.setLoading();
    try {
      const page = await api.get<Page<InventoryRecord>>('/inventory', { limit: PAGE_SIZE, offset: pager.currentOffset });
      table.setRows(page.items);
      pager.update(page.total);
    } catch (error) {
      table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }

  // ── Запуск ───────────────────────────────────────────────────

  private openStartModal(): void {
    const territorySelect = h('select', { 'aria-label': 'Территория' });
    const roomSelect = h('select', { 'aria-label': 'Кабинет' });
    const basisInput = h('input', { type: 'text', placeholder: 'Приказ, распоряжение…', maxlength: 255, class: 'search' });
    territorySelect.append(h('option', { value: '' }, 'Загрузка…'));
    roomSelect.append(h('option', { value: '' }, 'Все помещения территории'));

    void api.get<InventoryTerritory[]>('/inventory/territories').then((territories) => {
      territorySelect.replaceChildren(
        h('option', { value: '' }, 'Выберите территорию'),
        ...territories.map((t) => h('option', { value: t.building_id }, `${t.name} — ${t.address} (${t.equipment_count})`)),
      );
    }).catch((error) => toast(errorMessage(error), 'error'));

    const loadRooms = (buildingId: number) => {
      roomSelect.replaceChildren(h('option', { value: '' }, 'Все помещения территории'));
      if (!buildingId) return;
      void api.get<InventoryRoom[]>(`/inventory/territories/${buildingId}/rooms`).then((rooms) => {
        roomSelect.append(
          ...rooms.map((r) => h('option', { value: r.room_id }, `каб. ${r.room_no}, этаж ${r.floor} (${r.equipment_count})`)),
        );
      }).catch((error) => toast(errorMessage(error), 'error'));
    };
    territorySelect.addEventListener('change', () => loadRooms(Number(territorySelect.value)));

    const field = (label: string, control: HTMLElement) =>
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);

    const body = h('div', { class: 'form' },
      field('Подконтрольная территория', territorySelect),
      field('Кабинет (необязательно)', roomSelect),
      h('label', { class: 'field field--wide' }, h('span', { class: 'field-label' }, 'Основание инвентаризации'), basisInput),
    );

    new Modal('Начать инвентаризацию', body, [
      { label: 'Отмена', onClick: () => undefined },
      {
        label: 'Начать',
        kind: 'primary',
        onClick: async () => {
          const buildingId = Number(territorySelect.value);
          if (!buildingId) {
            toast('Выберите территорию', 'error');
            return false;
          }
          const basis = basisInput.value.trim();
          if (!basis) {
            toast('Укажите основание инвентаризации', 'error');
            return false;
          }
          try {
            const detail = await api.post<InventoryDetail>('/inventory', {
              basis,
              building_id: buildingId,
              room_id: roomSelect.value ? Number(roomSelect.value) : null,
            });
            toast('Инвентаризация начата');
            location.hash = `#/inventory/${detail.inventory_id}`;
            return true;
          } catch (error) {
            toast(errorMessage(error), 'error');
            return false;
          }
        },
      },
    ]).open();
  }

  // ── Детальная инвентаризация ────────────────────────────────

  private async showDetail(id: number): Promise<void> {
    try {
      this.detail = await api.get<InventoryDetail>(`/inventory/${id}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
      this.element.replaceChildren(h('a', { class: 'back', href: '#/inventory' }, '← К инвентаризациям'));
      return;
    }
    this.renderDetail();
  }

  private renderDetail(): void {
    const detail = this.detail!;
    this.camera?.stop();
    this.camera = null;

    this.summaryEl = h('div', { class: 'inv-summary' });
    this.progressFill = h('div', { class: 'inv-progress-fill' });
    this.statsEl = h('div', { class: 'inv-progress-stats' });
    this.summaryEl.append(
      h('div', { class: 'inv-progress' },
        h('div', { class: 'inv-progress-track' }, this.progressFill),
        this.statsEl,
      ),
    );
    this.tableBody = h('tbody');
    this.cardsEl = h('div', { class: 'inv-cards' });
    this.scanInput = h('input', {
      type: 'text',
      class: 'search',
      placeholder: 'Сканер: считайте QR-код или введите инв. №',
      autocomplete: 'off',
    });
    this.scanInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.scan(this.scanInput!.value);
      }
    });

    const open = detail.status === 'open';

    const tableWrap = h('div', { class: 'table-wrap inv-table-desktop' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, 'В наличии'),
          h('th', null, 'Инв. №'),
          h('th', null, 'Наименование / Модель'),
          h('th', null, 'Сер. №'),
          h('th', null, 'Кабинет / РМ'),
          h('th', null, 'Статус'),
        )),
        this.tableBody,
      ),
    );

    const children: HTMLElement[] = [
      h('a', { class: 'back', href: '#/inventory' }, '← К инвентаризациям'),
      h('div', { class: 'page-head inv-page-head' },
        h('div', null,
          h('h1', null, `Инвентаризация № ${detail.inventory_id}`, inventoryStatusBadge(detail.status)),
          h('p', { class: 'muted' },
            [detail.building_name, detail.room_no ? `каб. ${detail.room_no}` : null, `от ${formatDate(detail.started_on)}`].filter(Boolean).join(' · '),
          ),
          h('p', { class: 'muted small' }, `Основание: ${detail.basis}`),
        ),
        h('div', { class: 'actions' },
          Button('Печать', { variant: 'light', onClick: () => this.print() }),
          open ? Button('Завершить', { variant: 'accent', onClick: () => this.finish() }) : null,
        ),
      ),
      this.summaryEl!,
    ];
    if (open) {
      const scanRow = h('div', { class: 'filters' }, this.scanInput!, h('span', { class: 'muted small' }, 'Отсканируйте QR-этикетку или отметьте технику в таблице'));
      if ('BarcodeDetector' in window) {
        scanRow.append(Button('Сканер (камера)', { variant: 'light', onClick: () => this.toggleCamera() }));
      }
      children.push(scanRow);
    }
    children.push(tableWrap);
    children.push(this.cardsEl!);
    this.element.replaceChildren(...children);
    this.renderItems();
  }

  private renderItems(): void {
    const detail = this.detail!;
    const present = detail.items.filter((item) => item.checked && item.is_present).length;
    const percent = detail.total_count ? Math.round((detail.checked_count / detail.total_count) * 100) : 0;
    this.progressFill!.style.width = `${percent}%`;
    this.statsEl!.replaceChildren(
      h('div', { class: 'inv-stat' }, h('span', { class: 'inv-stat-value' }, String(detail.checked_count)), h('span', { class: 'inv-stat-label' }, 'проверено')),
      h('div', { class: 'inv-stat' }, h('span', { class: 'inv-stat-value' }, String(present)), h('span', { class: 'inv-stat-label' }, 'в наличии')),
      h('div', { class: 'inv-stat' }, h('span', { class: 'inv-stat-value' }, String(detail.total_count)), h('span', { class: 'inv-stat-label' }, 'всего')),
    );

    const open = detail.status === 'open';
    const rows = detail.items.map((item) => {
      const stateButton = this.stateButton(item, open);
      return h('tr', { class: item.checked ? 'checked-row' : null },
        h('td', { class: 'inv-check-cell', 'data-label': 'Наличие' }, stateButton),
        h('td', { 'data-label': 'Инв. №' }, h('span', { class: 'inv-no' }, item.inventory_no)),
        h('td', { 'data-label': 'Наименование' },
          h('div', null, h('strong', null, item.model_name)),
          h('div', { class: 'muted small' }, `${item.manufacturer_name} · ${item.type_name}`),
        ),
        h('td', { 'data-label': 'Сер. №' }, dash(item.serial_no)),
        h('td', { 'data-label': 'Кабинет / РМ' }, item.room_no ? `каб. ${item.room_no}, РМ ${dash(item.workplace_no)}` : '—'),
        h('td', { 'data-label': 'Статус' }, statusCell(item)),
      );
    });
    if (rows.length === 0) {
      this.tableBody!.replaceChildren(
        h('tr', null, h('td', { colspan: 6, class: 'table-empty' }, 'В выбранной области нет техники')),
      );
    } else {
      this.tableBody!.replaceChildren(...rows);
    }

    const cards = detail.items.map((item) => this.buildCard(item, open));
    if (cards.length === 0) {
      this.cardsEl!.replaceChildren(h('p', { class: 'muted inv-cards-empty' }, 'В выбранной области нет техники'));
    } else {
      this.cardsEl!.replaceChildren(...cards);
    }
  }

  private stateButton(item: InventoryItem, open: boolean): HTMLButtonElement {
    const state = stateOf(item);
    const button = h('button', {
      type: 'button',
      class: `inv-state inv-state--${state}`,
      'aria-label': `Отметить ${item.inventory_no}: ${STATE_LABELS[state]}`,
      title: STATE_LABELS[state],
    }, h('span', { class: 'inv-state-box' }));
    if (!open) button.disabled = true;
    button.addEventListener('click', () => void this.cycle(item, button));
    return button;
  }

  private buildCard(item: InventoryItem, open: boolean): HTMLElement {
    return h('div', { class: item.checked ? 'inv-card inv-card--checked' : 'inv-card' },
      h('div', { class: 'inv-card-head' },
        this.stateButton(item, open),
        h('div', { class: 'inv-card-title' },
          h('strong', null, item.model_name),
          h('div', { class: 'muted small' }, `${item.manufacturer_name} · ${item.type_name}`),
        ),
        h('div', { class: 'inv-card-status' }, statusCell(item)),
      ),
      h('div', { class: 'inv-card-meta' },
        h('span', { class: 'inv-no' }, item.inventory_no),
        item.serial_no ? h('span', { class: 'inv-card-fact' }, `SN ${item.serial_no}`) : null,
        h('span', { class: 'inv-card-fact' }, item.room_no ? `каб. ${item.room_no}, РМ ${dash(item.workplace_no)}` : 'Склад'),
      ),
    );
  }

  private async cycle(item: InventoryItem, button: HTMLButtonElement): Promise<void> {
    const order: InvState[] = ['empty', 'present', 'missing'];
    const next = order[(order.indexOf(stateOf(item)) + 1) % order.length];
    const payload = next === 'empty'
      ? { checked: false, is_present: false, discrepancy: null }
      : next === 'present'
        ? { checked: true, is_present: true, discrepancy: null }
        : { checked: true, is_present: false, discrepancy: 'missing' };
    button.disabled = true;
    try {
      const updated = await api.post<InventoryItem>(`/inventory/${this.detail!.inventory_id}/items/${item.equipment_id}`, payload);
      const index = this.detail!.items.findIndex((row) => row.equipment_id === item.equipment_id);
      this.detail!.items[index] = updated;
      this.recount();
      this.renderItems();
      toast(`${updated.inventory_no} — ${STATE_LABELS[stateOf(updated)]}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
      button.disabled = false;
    }
  }

  private async scan(code: string): Promise<void> {
    if (!code.trim()) return;
    this.scanInput!.disabled = true;
    try {
      const updated = await api.post<InventoryItem>(`/inventory/${this.detail!.inventory_id}/scan`, { code: code.trim() });
      const index = this.detail!.items.findIndex((row) => row.equipment_id === updated.equipment_id);
      this.detail!.items[index] = updated;
      this.recount();
      this.renderItems();
      this.scanInput!.value = '';
      toast(`Отмечено: ${updated.inventory_no}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
      this.scanInput!.select();
    } finally {
      this.scanInput!.disabled = false;
      this.scanInput!.focus();
    }
  }

  private recount(): void {
    const items = this.detail!.items;
    this.detail!.checked_count = items.filter((item) => item.checked).length;
  }

  private async finish(): Promise<void> {
    const id = this.detail!.inventory_id;
    try {
      await api.post<InventoryRecord>(`/inventory/${id}/finish`, undefined);
      toast('Инвентаризация завершена');
      this.detail = await api.get<InventoryDetail>(`/inventory/${id}`);
      this.renderDetail();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  // ── Сканер камерой (BarcodeDetector) ─────────────────────────

  private toggleCamera(): void {
    if (this.camera) {
      this.camera.stop();
      this.camera = null;
      return;
    }
    const video = h('video', { playsinline: true, muted: true, class: 'scan-video' }) as HTMLVideoElement;
    const holder = h('div', { class: 'scan-camera' }, video);
    this.element.querySelector('.filters')?.after(holder);

    const detector = new (window as unknown as { BarcodeDetector: new (options: { formats: string[] }) => { detect: (source: unknown) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] });
    let running = true;
    let stream: MediaStream | null = null;

    const stop = () => {
      running = false;
      stream?.getTracks().forEach((track) => track.stop());
      holder.remove();
      if (this.camera) this.camera = null;
    };
    this.camera = { video, stop };

    const tick = async () => {
      if (!running) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          stop();
          void this.scan(codes[0].rawValue);
          return;
        }
      } catch {
        // кадр ещё не готов — пробуем дальше
      }
      requestAnimationFrame(() => void tick());
    };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        void video.play();
        void tick();
      })
      .catch(() => {
        toast('Камера недоступна — введите код вручную', 'error');
        stop();
      });
  }

  // ── Печать чек-листа ────────────────────────────────────────

  private print(): void {
    const detail = this.detail!;
    const rows = detail.items.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${item.inventory_no}</td>
        <td>${item.type_name} ${item.manufacturer_name} ${item.model_name}</td>
        <td>${dash(item.serial_no)}</td>
        <td>${item.room_no ? `каб. ${item.room_no}, РМ ${dash(item.workplace_no)}` : '—'}</td>
        <td class="box"></td>
        <td></td>
      </tr>`).join('');

    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Инвентаризация № ${detail.inventory_id}</title>
<style>
  body { font-family: Arial, sans-serif; color: #000; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; margin: 0 0 16px; color: #333; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.box { width: 20px; height: 14px; }
  .sign { display: flex; gap: 48px; margin-top: 40px; font-size: 12px; }
  .sign div { flex: 1; border-top: 1px solid #000; padding-top: 4px; }
</style></head><body>
  <h1>Инвентаризация № ${detail.inventory_id}</h1>
  <p class="meta">Территория: ${dash(detail.building_name)}${detail.room_no ? `, кабинет ${detail.room_no}` : ''} · Дата: ${formatDate(detail.started_on)} · Ответственный: ${dash(detail.responsible_name)}</p>
  <p class="meta">Основание: ${detail.basis}</p>
  <table>
    <thead><tr><th>№</th><th>Инв. №</th><th>Наименование</th><th>Сер. №</th><th>Размещение</th><th>В наличии</th><th>Примечание</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign"><div>Подпись ответственного лица</div><div>Дата</div></div>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      toast('Разрешите всплывающие окна для печати', 'error');
      return;
    }
    win.document.write(html);
    win.document.close();
  }
}
