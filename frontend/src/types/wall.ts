import type { Cm } from '../utils/scale';

export interface WallData {
  id: string;
  /** Точка начала стены (X), см */
  x: Cm;
  /** Точка начала стены (Y), см */
  y: Cm;
  /** Длина стены вдоль направления rotation, см */
  length: Cm;
  /** Толщина стены, одинаковая по всей длине, см */
  thickness: Cm;
  /** Угол направления стены в градусах */
  rotation: number;
}
