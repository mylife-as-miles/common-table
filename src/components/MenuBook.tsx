import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  ChevronRight,
  Fingerprint,
  Check,
  MapPin,
  Sparkles,
  Star,
  Utensils,
  X,
} from "lucide-react";
import type { Venue } from "../domain/types";
import "./menu-book.css";
import { playInteractionSound } from "../experience/interactionSound";
import { PaperCurl } from "./book/PaperCurl";
import type { CurlDirection, CurlState } from "./book/PaperCurl";
import { pagePrint } from "./book/pagePrint";

export interface MenuBookProps {
  venue: Venue;
  nextVenue?: Venue;
  previousVenue?: Venue;
  shortlisted: boolean;
  chosen?: boolean;
  onShortlist: () => void;
  onVeto: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onChoose: () => void;
  index: number;
  total: number;
  reason: string;
  lowPower: boolean;
}

export default function MenuBook({
  venue,
  nextVenue,
  previousVenue,
  shortlisted,
  chosen = false,
  onShortlist,
  onVeto,
  onNext,
  onPrevious,
  onChoose,
  index,
  total,
  reason,
  lowPower,
}: MenuBookProps) {
  const rightPage = useRef<HTMLElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const scene = useRef<HTMLDivElement>(null);
  const frontBoard = useRef<HTMLDivElement>(null);
  const paperPages = useRef<HTMLDivElement>(null);
  const curlStage = useRef<HTMLDivElement>(null);
  const curl = useRef<PaperCurl | null>(null);
  const curlState = useRef<CurlState>("idle");
  const queue = useRef<CurlDirection[]>([]);
  const committedTarget = useRef<string | null>(null);
  const deferredTurn = useRef<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    direction: CurlDirection;
    moved: boolean;
    target: HTMLButtonElement;
  } | null>(null);
  const suppressCornerClick = useRef(false);
  const folioToggle = useRef<HTMLButtonElement>(null);
  const animations = useRef(new Set<Animation>());
  const pointerFrame = useRef<number | null>(null);
  const coverStart = useRef("rotateY(0deg)");
  const [isOpen, setIsOpen] = useState(true);
  const openState = useRef(isOpen);
  openState.current = isOpen;
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const motionOff = lowPower || reducedMotion;
  const play = (
    element: HTMLElement,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    const animation = element.animate(frames, options);
    animations.current.add(animation);
    animation.finished
      .then(() => animations.current.delete(animation))
      .catch(() => animations.current.delete(animation));
    return animation;
  };
  const resetParallax = () => {
    if (pointerFrame.current !== null)
      cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    scene.current?.style.setProperty("--folio-rx", "0deg");
    scene.current?.style.setProperty("--folio-ry", "0deg");
    scene.current?.style.setProperty("--folio-shine-x", "28%");
    scene.current?.style.setProperty("--folio-shine-y", "18%");
  };
  const followPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      motionOff ||
      curl.current ||
      isMobile ||
      !isOpen ||
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    if (pointerFrame.current !== null)
      cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      scene.current?.style.setProperty("--folio-rx", `${(0.5 - y) * 3}deg`);
      scene.current?.style.setProperty("--folio-ry", `${(x - 0.5) * 3.5}deg`);
      scene.current?.style.setProperty("--folio-shine-x", `${x * 100}%`);
      scene.current?.style.setProperty("--folio-shine-y", `${y * 100}%`);
    });
  };
  const toggleFolio = () => {
    stopCurl();
    coverStart.current = frontBoard.current
      ? getComputedStyle(frontBoard.current).transform
      : isOpen
        ? "rotateY(-177deg)"
        : "rotateY(0deg)";
    playInteractionSound("page");
    setIsOpen((value) => !value);
    resetParallax();
  };
  const latest = useRef({
    venue,
    nextVenue,
    previousVenue,
    onNext,
    onPrevious,
    index,
    total,
  });
  latest.current = {
    venue,
    nextVenue,
    previousVenue,
    onNext,
    onPrevious,
    index,
    total,
  };
  const updateCurlState = (state: CurlState) => {
    curlState.current = state;
    if (scene.current) scene.current.dataset.flipState = state;
    if (paperPages.current) {
      paperPages.current.inert = state !== "idle" || !openState.current;
      paperPages.current.setAttribute(
        "aria-hidden",
        String(state !== "idle" || !openState.current),
      );
    }
    if (curlStage.current) curlStage.current.dataset.flipState = state;
  };
  const stopCurl = (clearQueue = true) => {
    if (curl.current) suppressCornerClick.current = true;
    curl.current?.dispose();
    curl.current = null;
    committedTarget.current = null;
    updateCurlState("idle");
    if (clearQueue) queue.current = [];
    if (deferredTurn.current !== null)
      cancelAnimationFrame(deferredTurn.current);
    deferredTurn.current = null;
    const active = drag.current;
    if (active) suppressCornerClick.current = true;
    drag.current = null;
    if (active?.target.hasPointerCapture(active.pointerId))
      active.target.releasePointerCapture(active.pointerId);
  };
  const makeCurl = (direction: CurlDirection) => {
    const stage = curlStage.current,
      pages = paperPages.current;
    if (!stage || !pages) return null;
    const place = pages.querySelector<HTMLElement>(".book-page-left");
    const menu = pages.querySelector<HTMLElement>(".book-page-right");
    if (!place || !menu) return null;
    const data = latest.current;
    const before = data.previousVenue || data.venue;
    const after = data.nextVenue || data.venue;
    const width = pages.clientWidth,
      height = pages.clientHeight;
    const sequence = [before, data.venue, after];
    const print = sequence.flatMap((item, i) => {
      const pageIndex =
        (data.index + i - 1 + data.total) % Math.max(data.total, 1);
      if (isMobile)
        return [
          pagePrint(
            mobileView === "menu" ? menu : place,
            item,
            pageIndex,
            mobileView,
            i === 1,
          ),
        ];
      return [
        pagePrint(place, item, pageIndex, "place", i === 1),
        pagePrint(menu, item, pageIndex, "menu", i === 1),
      ];
    });
    const target = direction === "next" ? after : before;
    const instance = new PaperCurl(
      stage,
      print,
      width,
      height,
      isMobile,
      updateCurlState,
      (turned) => {
        if (curl.current !== instance) return;
        if (!turned) {
          stopCurl();
          return;
        }
        committedTarget.current = target.id;
        // Domain state changes once, only after the physical leaf settles.
        if (direction === "next") latest.current.onNext();
        else latest.current.onPrevious();
      },
    );
    curl.current = instance;
    return instance;
  };
  const requestTurn = (direction: CurlDirection) => {
    if (latest.current.total < 2) return;
    if (
      (curl.current && curlState.current === "flipping") ||
      deferredTurn.current !== null
    ) {
      queue.current.push(direction);
      return;
    }
    stopCurl(false);
    if (
      motionOff ||
      !isOpen ||
      !(direction === "next"
        ? latest.current.nextVenue
        : latest.current.previousVenue)
    ) {
      playInteractionSound("page");
      if (direction === "next") latest.current.onNext();
      else latest.current.onPrevious();
      return;
    }
    const instance = makeCurl(direction);
    if (instance) {
      playInteractionSound("page");
      instance.flip(direction);
    }
  };
  const nextRestaurant = () => requestTurn("next");
  const previousRestaurant = () => requestTurn("previous");
  const beginCornerDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: CurlDirection,
  ) => {
    suppressCornerClick.current = false;
    if (event.button !== 0 || motionOff || !isOpen || total < 2) return;
    if (!(direction === "next" ? nextVenue : previousVenue)) return;
    if (curlState.current === "flipping") return;
    stopCurl();
    const instance = makeCurl(direction);
    if (!instance) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      direction,
      moved: false,
      target: event.currentTarget,
    };
    instance.begin(instance.point(event.clientX, event.clientY));
  };
  const moveCornerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current,
      instance = curl.current;
    if (!active || !instance || active.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 5)
      active.moved = true;
    if (active.moved)
      instance.move(instance.point(event.clientX, event.clientY));
  };
  const endCornerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current,
      instance = curl.current;
    if (!active || !instance || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (active.target.hasPointerCapture(event.pointerId))
      active.target.releasePointerCapture(event.pointerId);
    if (!active.moved) {
      stopCurl();
      suppressCornerClick.current = false;
      return;
    }
    suppressCornerClick.current = true;
    playInteractionSound("page");
    const distance =
      active.direction === "next"
        ? active.x - event.clientX
        : event.clientX - active.x;
    const pageWidth =
      (paperPages.current?.clientWidth || 360) / (isMobile ? 1 : 2);
    const commit = distance > Math.max(36, pageWidth * 0.28);
    instance.release(instance.point(event.clientX, event.clientY), commit);
  };
  const cornerClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    direction: CurlDirection,
  ) => {
    if (suppressCornerClick.current && event.detail > 0) {
      suppressCornerClick.current = false;
      return;
    }
    suppressCornerClick.current = false;
    requestTurn(direction);
  };
  const [mobileView, setMobileView] = useState<"place" | "menu">("menu");
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(
    () => () => {
      if (pointerFrame.current !== null)
        cancelAnimationFrame(pointerFrame.current);
      animations.current.forEach((animation) => animation.cancel());
      animations.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (!motionOff) return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    resetParallax();
  }, [motionOff]);
  useLayoutEffect(() => {
    const board = frontBoard.current;
    if (!board) return;
    const target = isOpen
      ? isMobile
        ? "rotateY(-72deg)"
        : "rotateY(-177deg)"
      : "rotateY(0deg)";
    board.style.visibility = isOpen ? "hidden" : "visible";
    if (motionOff || !board.animate || coverStart.current === target) {
      coverStart.current = target;
      return;
    }
    board.style.visibility = "visible";
    const animation = play(
      board,
      [
        {
          transform:
            coverStart.current === "none" ? target : coverStart.current,
        },
        { transform: target },
      ],
      { duration: isMobile ? 430 : 900, easing: "cubic-bezier(.22,.64,.2,1)" },
    );
    const faceAnimations: Animation[] = [];
    const boardFront = board.querySelector<HTMLElement>(".folio-board-front");
    const boardBack = board.querySelector<HTMLElement>(".folio-board-back");
    if (!isMobile && boardFront && boardBack) {
      const frontFrames = isOpen
        ? [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 0.51 },
            { opacity: 0, offset: 1 },
          ]
        : [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.49 },
            { opacity: 1, offset: 0.5 },
            { opacity: 1, offset: 1 },
          ];
      faceAnimations.push(
        play(boardFront, frontFrames, {
          duration: 900,
          easing: "cubic-bezier(.22,.64,.2,1)",
        }),
      );
      faceAnimations.push(
        play(
          boardBack,
          frontFrames.map((frame) => ({
            ...frame,
            opacity: 1 - frame.opacity,
          })),
          { duration: 900, easing: "cubic-bezier(.22,.64,.2,1)" },
        ),
      );
    }
    animation.finished
      .then(() => {
        coverStart.current = target;
        board.style.visibility = isOpen ? "hidden" : "visible";
      })
      .catch(() => {});
    return () => {
      animation.cancel();
      faceAnimations.forEach((face) => face.cancel());
    };
  }, [isOpen, isMobile, motionOff]);
  useLayoutEffect(() => {
    if (!curl.current) return;
    if (committedTarget.current === venue.id) {
      const waiting = queue.current.shift();
      stopCurl(false);
      if (waiting)
        deferredTurn.current = requestAnimationFrame(() => {
          deferredTurn.current = null;
          requestTurn(waiting);
        });
    } else stopCurl();
  }, [venue.id]);
  useEffect(() => {
    stopCurl();
  }, [isMobile, mobileView, isOpen, motionOff]);
  useEffect(() => {
    const cancel = () => stopCurl();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && curl.current) {
        event.preventDefault();
        stopCurl();
      }
    };
    window.addEventListener("resize", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      stopCurl();
    };
  }, []);
  const handleTabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: "place" | "menu";
    if (event.key === "Home") next = "place";
    else if (event.key === "End") next = "menu";
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      next = mobileView === "menu" ? "place" : "menu";
    else return;
    event.preventDefault();
    setMobileView(next);
    tabs.current
      ?.querySelector<HTMLButtonElement>(`[data-page="${next}"]`)
      ?.focus();
  };

  return (
    <div
      ref={scene}
      className={`menu-book-scene${lowPower ? " menu-book-low-power" : ""}${!isOpen ? " folio-closed" : ""}`}
      data-folio-open={isOpen}
      data-flip-state="idle"
      onPointerMove={followPointer}
      onPointerLeave={resetParallax}
    >
      <div className="folio-table-light" aria-hidden="true" />
      <div className="book-shadow" aria-hidden="true" />
      <div className="folio-object-tools">
        <span>
          <i /> THE SUPPER FOLIO <small>VOL. 01</small>
        </span>
        <button
          type="button"
          ref={folioToggle}
          onClick={toggleFolio}
          aria-expanded={isOpen}
          aria-controls={`${panelId}-spread`}
        >
          <BookOpen size={14} />
          {isOpen ? "Close folio" : "Open folio"}
        </button>
      </div>
      <div
        className="book-mobile-tabs"
        ref={tabs}
        role="tablist"
        aria-label="Restaurant book pages"
        hidden={!isMobile}
        inert={!isOpen}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          id={`${panelId}-place-tab`}
          role="tab"
          data-page="place"
          aria-controls={`${panelId}-place`}
          aria-selected={mobileView === "place"}
          tabIndex={mobileView === "place" ? 0 : -1}
          onClick={() => setMobileView("place")}
          onKeyDown={handleTabKeys}
        >
          <MapPin size={14} /> The place
        </button>
        <button
          type="button"
          id={`${panelId}-menu-tab`}
          role="tab"
          data-page="menu"
          aria-controls={`${panelId}-menu`}
          aria-selected={mobileView === "menu"}
          tabIndex={mobileView === "menu" ? 0 : -1}
          onClick={() => setMobileView("menu")}
          onKeyDown={handleTabKeys}
        >
          <Utensils size={14} /> The menu
        </button>
      </div>
      <article
        className="menu-book"
        aria-label={`Restaurant menu: ${venue.name}`}
      >
        <div className="book-cover" aria-hidden="true" />
        <div
          className="book-page-stack book-page-stack-left"
          aria-hidden="true"
        />
        <div
          className="book-page-stack book-page-stack-right"
          aria-hidden="true"
        />
        <div
          className="book-pages"
          ref={paperPages}
          id={`${panelId}-spread`}
          aria-hidden={!isOpen}
          inert={!isOpen}
        >
          <section
            className="book-page book-page-left"
            id={`${panelId}-place`}
            role={isMobile ? "tabpanel" : undefined}
            aria-labelledby={isMobile ? `${panelId}-place-tab` : undefined}
            hidden={isMobile && mobileView !== "place"}
            tabIndex={isMobile ? 0 : undefined}
          >
            <div className="book-imprint">
              <Utensils size={12} strokeWidth={1.4} />
              <span>COMMON TABLE</span>
              <i>Field notes, for good company.</i>
            </div>
            <div className="book-photo-wrap">
              <img
                ref={photo}
                className="book-venue-photo"
                src={venue.image}
                alt={`Atmosphere at ${venue.name}, an illustrative demo restaurant`}
                loading="eager"
                decoding="async"
              />
              <div className="book-photo-wash" aria-hidden="true" />
              <span className="book-photo-caption">
                <MapPin size={11} /> {venue.neighborhood}, Brooklyn
              </span>
              <div className="book-editor-stamp" aria-hidden="true">
                <span>GOOD FOOD</span>
                <Utensils size={20} strokeWidth={1.3} />
                <span>BETTER COMPANY</span>
              </div>
            </div>
            <div className="book-left-story">
              <span className="book-mobile-venue-name">{venue.name}</span>
              <span className="book-kicker">A PLACE TO LINGER</span>
              <h3>
                A little off the
                <br />
                beaten path.
              </h3>
              <p>{venue.story || venue.description}</p>
              <div className="book-details">
                <span>
                  <Star size={12} fill="currentColor" />{" "}
                  {venue.rating.toFixed(1)} <small>demo rating</small>
                </span>
                <span>
                  {venue.walkMinutes} min walk <small>illustrative</small>
                </span>
                <span>
                  ${venue.price} <small>/ person</small>
                </span>
              </div>
            </div>
            <div className="book-page-number">
              <span>Brooklyn, one good meal at a time.</span>
              <span>{String(index * 2 + 1).padStart(2, "0")}</span>
            </div>
          </section>

          <section
            ref={rightPage}
            className="book-page book-page-right"
            id={`${panelId}-menu`}
            role={isMobile ? "tabpanel" : undefined}
            aria-labelledby={isMobile ? `${panelId}-menu-tab` : undefined}
            hidden={isMobile && mobileView !== "menu"}
            tabIndex={isMobile ? 0 : undefined}
          >
            <div className="book-right-top">
              <span className="book-kicker">YOUR NEXT GOOD EVENING</span>
              <button
                className={`book-bookmark${shortlisted ? " is-saved" : ""}`}
                type="button"
                onClick={() => {
                  stopCurl();
                  onShortlist();
                }}
                aria-label={
                  shortlisted
                    ? `Remove ${venue.name} from shortlist`
                    : `Save ${venue.name} to shortlist`
                }
                aria-pressed={shortlisted}
                title={shortlisted ? "Saved to shortlist" : "Save to shortlist"}
              >
                <Bookmark
                  size={17}
                  strokeWidth={1.5}
                  fill={shortlisted ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div className="book-restaurant-title" key={venue.id}>
              <div className="book-tiny-rule" aria-hidden="true" />
              <h2>{venue.name}</h2>
              <p className="book-restaurant-cuisine">{venue.cuisine}</p>
            </div>
            <div className="book-menu-divider">
              <span /> <Utensils size={15} strokeWidth={1.15} /> <span />
            </div>
            <div className="book-menu-heading">
              <span>A TASTE OF THE MENU</span>
              <span>DEMO MENU</span>
            </div>
            <ul className="book-menu-items">
              {venue.menu.slice(0, 3).map((dish) => (
                <li key={dish.name}>
                  <div className="book-dish-name">
                    <h3>{dish.name}</h3>
                    <span className="book-dotted-leader" aria-hidden="true" />
                    <span>${dish.price}</span>
                  </div>
                  <p>{dish.description}</p>
                </li>
              ))}
            </ul>
            <div className="book-match-note">
              <Sparkles size={16} strokeWidth={1.4} />
              <div>
                <span>A LITTLE THOUGHT WENT INTO THIS</span>
                <p>{reason}</p>
              </div>
            </div>
            <button
              className="book-choose"
              type="button"
              onClick={() => {
                stopCurl();
                onChoose();
              }}
            >
              <span>
                {chosen ? <Check size={16} /> : <ArrowDownLeft size={17} />}{" "}
                {chosen ? "At your table · review" : "Bring this to the table"}
              </span>
              <ArrowRight size={17} />
            </button>
            <button
              className="book-veto"
              type="button"
              onClick={() => {
                stopCurl();
                onVeto();
              }}
            >
              <X size={12} /> Not this time · find another
            </button>
            <div className="book-page-number">
              <span>Something everyone can say yes to.</span>
              <span>{String(index * 2 + 2).padStart(2, "0")}</span>
            </div>
          </section>
          <div className="book-spine" aria-hidden="true" />
        </div>
        <div
          ref={curlStage}
          className="folio-curl-stage"
          aria-hidden="true"
          data-flip-state="idle"
        />
        <button
          type="button"
          className="folio-page-corner"
          onClick={(event) => cornerClick(event, "next")}
          onPointerDown={(event) => beginCornerDrag(event, "next")}
          onPointerMove={moveCornerDrag}
          onPointerUp={endCornerDrag}
          onPointerCancel={() => {
            suppressCornerClick.current = true;
            stopCurl();
          }}
          aria-label="Turn this page"
          hidden={!isOpen}
          disabled={total < 2}
        >
          <span className="folio-corner-paper" aria-hidden="true" />
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          className="folio-back-corner"
          onClick={(event) => cornerClick(event, "previous")}
          onPointerDown={(event) => beginCornerDrag(event, "previous")}
          onPointerMove={moveCornerDrag}
          onPointerUp={endCornerDrag}
          onPointerCancel={() => {
            suppressCornerClick.current = true;
            stopCurl();
          }}
          aria-label="Turn back a page"
          hidden={!isOpen}
          disabled={total < 2}
        >
          <span aria-hidden="true" />
          <ArrowLeft size={13} />
        </button>
        <div
          ref={frontBoard}
          className="folio-front-board"
          aria-hidden={isOpen}
        >
          <div className="folio-board-front">
            <div className="folio-cover-border" />
            <span className="folio-cover-imprint">COMMON TABLE</span>
            <div className="folio-cover-seal">
              <Utensils size={37} strokeWidth={1} />
              <i />
            </div>
            <h3>{venue.name}</h3>
            <p>{venue.cuisine}</p>
            <span className="folio-cover-edition">
              BROOKLYN · THE SUPPER EDITION
            </span>
            <button
              type="button"
              hidden={isOpen}
              onClick={() => {
                toggleFolio();
                requestAnimationFrame(() =>
                  folioToggle.current?.focus({ preventScroll: true }),
                );
              }}
            >
              <Fingerprint size={17} strokeWidth={1.2} />
              Open the folio
              <ArrowRight size={15} />
            </button>
            <span className="folio-gold-corner folio-gold-corner-top" />
            <span className="folio-gold-corner folio-gold-corner-bottom" />
          </div>
          <div className="folio-board-back" />
        </div>
        <div className="folio-spine-binding" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="folio-ribbon" aria-hidden="true">
          <span>CT</span>
        </div>
      </article>
      <p className="folio-turn-hint">
        Drag a paper corner · or use the arrows to turn
      </p>
      <div className="book-navigation" aria-label="Browse restaurant menus">
        <button
          type="button"
          onClick={previousRestaurant}
          disabled={total < 2}
          aria-label="Previous restaurant"
        >
          <ArrowLeft size={17} />
        </button>
        <span>
          THE MENU <i /> <strong>{String(index + 1).padStart(2, "0")}</strong>
          <span className="book-nav-total">
            {" "}
            / {String(total).padStart(2, "0")}
          </span>
        </span>
        <button
          type="button"
          onClick={nextRestaurant}
          disabled={total < 2}
          aria-label="Next restaurant"
        >
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}

export { MenuBook };
