import type { WallEndpoint } from './geometry';

const ROOM_TITLE_PREFIX = 'каб.';
// "каб. 12", "каб.12", "Каб 12" и просто "12" — номер кабинета; "Коридор" или "каб. 12а" — нет.
const NUMBERED_TITLE = /^(?:каб\.?\s*)?(\d+)$/i;

/**
 * Названия для новых помещений — "каб. N": номера продолжают самый большой
 * среди уже занятых названий (переименованные в "Коридор" или "Холл" счёт не
 * сбивают), а между собой идут в порядке чтения плана — сверху вниз, слева
 * направо по верхним левым углам помещений (по центру высокая комната слева
 * оказалась бы после низкой справа). Возвращает названия в порядке corners.
 */
export function nextRoomTitles(takenTitles: readonly string[], corners: readonly WallEndpoint[]): string[] {
  let next =
    takenTitles.reduce((max, title) => {
      const match = NUMBERED_TITLE.exec(title.trim());
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  const order = corners
    .map((_, index) => index)
    .sort((a, b) => Math.round(corners[a].y) - Math.round(corners[b].y) || corners[a].x - corners[b].x);
  const titles = new Array<string>(corners.length);
  order.forEach((index) => {
    titles[index] = `${ROOM_TITLE_PREFIX} ${next++}`;
  });
  return titles;
}
