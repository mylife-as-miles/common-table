export interface PaperPoint {
  x: number;
  y: number;
}
export interface PaperRender {
  renderFrame(time: number): void;
  finishAnimation(): void;
  getRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
    pageWidth: number;
  };
}
export class PageFlip {
  constructor(element: HTMLElement, settings: Record<string, unknown>);
  loadFromHTML(pages: HTMLElement[]): void;
  destroy(): void;
  on(name: string, callback: (event: { data: unknown }) => void): this;
  off(name: string): void;
  getRender(): PaperRender;
  getUI(): { removeHandlers(): void };
  getFlipController(): {
    getCalculation(): {
      getPosition(): PaperPoint;
      getCorner(): "top" | "bottom";
    } | null;
    animateFlippingTo(from: PaperPoint, to: PaperPoint, turned: boolean): void;
  };
  getState(): string;
  getCurrentPageIndex(): number;
  startUserTouch(point: PaperPoint): void;
  userMove(point: PaperPoint, isTouch: boolean): void;
  userStop(point: PaperPoint, isSwipe?: boolean): void;
  flipNext(corner?: "top" | "bottom"): void;
  flipPrev(corner?: "top" | "bottom"): void;
}
