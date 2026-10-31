import { PageFlip } from "./st-page-flip.js";
import type { PaperPoint } from "./st-page-flip.js";

export type CurlDirection = "next" | "previous";
export type CurlState = "idle" | "dragging" | "flipping";

/** StPageFlip's actual soft-leaf solver, with an event-driven render lifetime. */
export class PaperCurl {
  private engine: PageFlip;
  private frame: number | null = null;
  private disposed = false;
  private completed = false;
  private ready = false;
  private notified = false;
  private initialPage: number;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  readonly mount: HTMLDivElement;

  constructor(
    private stage: HTMLElement,
    pages: HTMLElement[],
    private width: number,
    private height: number,
    mobile: boolean,
    private onState: (state: CurlState) => void,
    private onSettled: (turned: boolean) => void,
  ) {
    this.mount = document.createElement("div");
    this.mount.className = "folio-curl-engine";
    this.mount.style.width = `${width}px`;
    this.mount.style.height = `${height}px`;
    stage.replaceChildren(this.mount);
    this.initialPage = mobile ? 1 : 2;
    this.engine = new PageFlip(this.mount, {
      width: mobile ? width : width / 2,
      height,
      size: "fixed",
      startPage: this.initialPage,
      drawShadow: true,
      maxShadowOpacity: 0.31,
      flippingTime: 680,
      usePortrait: mobile,
      autoSize: false,
      showCover: false,
      useMouseEvents: false,
      mobileScrollSupport: true,
      showPageCorners: false,
      disableFlipByClick: false,
      swipeDistance: 36,
      startZIndex: 1,
    });
    this.engine.on("flip", ({ data }) => {
      this.stage.dataset.enginePage = String(data);
      if (this.ready && Number(data) !== this.initialPage)
        this.completed = true;
    });
    this.engine.on("changeState", ({ data }) => {
      this.stage.dataset.engineState = String(data);
      if (!this.ready || this.disposed) return;
      if (data === "user_fold") this.onState("dragging");
      if (data === "flipping") this.onState("flipping");
      if (data === "read") this.settle();
    });
    this.engine.loadFromHTML(pages);
    this.ready = true;
    this.draw();
  }

  private draw = () => {
    if (!this.disposed) this.engine.getRender().renderFrame(performance.now());
  };
  private tick = () => {
    this.frame = null;
    if (this.disposed) return;
    this.draw();
    if (!this.disposed && !this.notified && this.engine.getState() !== "read")
      this.frame = requestAnimationFrame(this.tick);
  };
  private animate() {
    if (this.frame === null && !this.disposed)
      this.frame = requestAnimationFrame(this.tick);
  }
  private settle() {
    if (this.notified || this.disposed) return;
    this.notified = true;
    // The upstream solver finishes resetting geometry after changeState fires.
    // Leave this stack before the owner removes its DOM.
    queueMicrotask(() => {
      if (!this.disposed) this.onSettled(this.completed);
    });
  }
  point(clientX: number, clientY: number): PaperPoint {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * this.width) / rect.width,
      y: ((clientY - rect.top) * this.height) / rect.height,
    };
  }
  begin(point: PaperPoint) {
    this.engine.startUserTouch(point);
    this.onState("dragging");
  }
  move(point: PaperPoint) {
    if (this.disposed) return;
    this.engine.userMove(point, true);
    this.draw();
  }
  release(point: PaperPoint, commit: boolean) {
    if (this.disposed) return;
    this.draw();
    this.engine.userStop(point, true);
    const controller = this.engine.getFlipController();
    const calculation = controller.getCalculation();
    if (calculation) {
      const rect = this.engine.getRender().getRect();
      // Same upstream completion solver from the exact held fold. On one-page
      // phones the spine is offscreen; use a deliberate 36px/28% gesture intent
      // rather than requiring the finger to leave the viewport.
      controller.animateFlippingTo(
        calculation.getPosition(),
        {
          x: commit ? -rect.pageWidth : rect.pageWidth,
          y: calculation.getCorner() === "bottom" ? rect.height : 0,
        },
        commit,
      );
    }
    this.onState("flipping");
    this.animate();
    // A press with no fold has nothing for the solver to finish.
    this.releaseTimer = setTimeout(() => {
      if (!this.disposed && this.engine.getState() === "read") this.settle();
    }, 32);
  }
  flip(direction: CurlDirection) {
    this.draw();
    this.onState("flipping");
    if (direction === "next") this.engine.flipNext("bottom");
    else this.engine.flipPrev("bottom");
    if (this.engine.getState() === "read") {
      this.settle();
      return;
    }
    this.animate();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.frame = null;
    this.engine.off("flip");
    this.engine.off("changeState");
    // Upstream installs resize listeners even when useMouseEvents is false.
    this.engine.getUI().removeHandlers();
    this.engine.destroy();
  }
}
