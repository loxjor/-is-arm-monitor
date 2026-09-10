export interface WallData {
  id: string;
  /** Точка начала стены (X) */
  x: number;
  /** Точка начала стены (Y) */
  y: number;
  /** Длина стены вдоль направления rotation */
  length: number;
  /** Толщина стены, одинаковая по всей длине */
  thickness: number;
  /** Угол направления стены в градусах */
  rotation: number;
}
