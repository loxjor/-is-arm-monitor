import QRCode from 'qrcode';
import type { EquipmentListItem } from '../api/types';
import { h } from './dom';

type LabelSource = Pick<
  EquipmentListItem,
  'equipment_id' | 'inventory_no' | 'serial_no' | 'type_name' | 'manufacturer_name' | 'model_name'
>;

/** Ссылка на карточку — её открывает сканер QR-кода. */
function cardUrl(equipmentId: number): string {
  return `${location.origin}${location.pathname}#/equipment/${equipmentId}`;
}

async function buildLabel(item: LabelSource): Promise<HTMLElement> {
  const svg = await QRCode.toString(cardUrl(item.equipment_id), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const qr = h('div', { class: 'label__qr' });
  qr.innerHTML = svg; // SVG собран библиотекой из нашей же ссылки

  return h('section', { class: 'label' },
    qr,
    h('div', { class: 'label__text' },
      h('div', { class: 'label__name' }, `${item.type_name} ${item.manufacturer_name} ${item.model_name}`),
      h('div', { class: 'label__row' }, h('span', null, 'Инв. №'), h('b', null, item.inventory_no)),
      h('div', { class: 'label__row' }, h('span', null, 'Сер. №'), h('b', null, item.serial_no || '—')),
    ),
  );
}

/**
 * Печать этикеток 90×40 мм — по одной на страницу. Этикетки собираются в служебном
 * контейнере, стили печати (admin.css) прячут остальной интерфейс.
 */
export async function printLabels(items: LabelSource[]): Promise<void> {
  const root = h('div', { id: 'label-print-root' }, await Promise.all(items.map(buildLabel)));
  // Размер страницы задаётся только на время печати этикеток, остальные экраны печатаются как раньше.
  const pageStyle = h('style', null, '@page { size: 90mm 40mm; margin: 0; }');
  document.head.append(pageStyle);
  document.body.append(root);
  document.body.classList.add('printing-labels');
  const cleanup = () => {
    root.remove();
    pageStyle.remove();
    document.body.classList.remove('printing-labels');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
