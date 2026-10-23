/** Экран, который роутер монтирует в область содержимого. */
export interface Screen {
  readonly title: string;
  readonly element: HTMLElement;
  destroy?(): void;
}

export interface RouteContext {
  params: string[];
  query: URLSearchParams;
}
