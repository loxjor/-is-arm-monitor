import { describe, expect, it } from 'vitest';
import { nextRoomTitles } from './roomNumbers';

describe('nextRoomTitles', () => {
  it('на пустом плане — с "каб. 1" в порядке чтения', () => {
    const corners = [
      { x: 500, y: 100 },
      { x: 100, y: 400 },
      { x: 100, y: 100.2 },
    ];
    expect(nextRoomTitles([], corners)).toEqual(['каб. 2', 'каб. 3', 'каб. 1']);
  });

  it('продолжает самый большой номер, переименованные помещения счёт не сбивают', () => {
    expect(nextRoomTitles(['каб. 101', 'Каб 7', '12', 'Коридор', 'каб. 205а'], [{ x: 0, y: 0 }])).toEqual([
      'каб. 102',
    ]);
  });
});
