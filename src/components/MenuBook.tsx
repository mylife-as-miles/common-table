import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
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

export interface MenuBookProps {
  venue: Venue;
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
  const previousVenue = useRef(venue);
  const rightPage = useRef<HTMLElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const scene = useRef<HTMLDivElement>(null);
  const frontBoard = useRef<HTMLDivElement>(null);
  const turningSheet = useRef<HTMLDivElement>(null);
  const folioToggle = useRef<HTMLButtonElement>(null);
  const animations = useRef(new Set<Animation>());
  const pointerFrame = useRef<number | null>(null);
  const coverStart = useRef("rotateY(0deg)");
  const turnDirection = useRef<"next" | "previous">("next");
  const [isOpen, setIsOpen] = useState(true);
  const [leafPrint, setLeafPrint] = useState(venue);
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
    coverStart.current = frontBoard.current
      ? getComputedStyle(frontBoard.current).transform
      : isOpen
        ? "rotateY(-177deg)"
        : "rotateY(0deg)";
    playInteractionSound("page");
    setIsOpen((value) => !value);
    resetParallax();
  };
  const nextRestaurant = () => {
    turnDirection.current = "next";
    playInteractionSound("page");
    onNext();
  };
  const previousRestaurant = () => {
    turnDirection.current = "previous";
    playInteractionSound("page");
    onPrevious();
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
  useEffect(() => {
    if (previousVenue.current.id === venue.id) return;
    const previous = previousVenue.current;
    previousVenue.current = venue;
    setLeafPrint(previous);
    if (motionOff || !isOpen) return;
    const running: Animation[] = [];
    const sheet = turningSheet.current;
    if (sheet?.animate) {
      const backwards = turnDirection.current === "previous";
      sheet.dataset.direction = backwards ? "previous" : "next";
      const sign = backwards ? 1 : -1;
      sheet.style.opacity = "1";
      const leafAnimation = play(
        sheet,
        [
          { transform: "perspective(1400px) rotateY(0deg)", offset: 0 },
          {
            transform: `perspective(1400px) rotateY(${sign * (isMobile ? 32 : 70)}deg)`,
            offset: 0.4,
          },
          {
            transform: `perspective(1400px) rotateY(${sign * (isMobile ? 50 : 155)}deg)`,
            offset: 0.8,
          },
          {
            transform: `perspective(1400px) rotateY(${sign * (isMobile ? 59 : 176)}deg)`,
            offset: 0.98,
          },
          {
            transform: `perspective(1400px) rotateY(${sign * (isMobile ? 62 : 179)}deg)`,
            offset: 1,
          },
        ],
        { duration: isMobile ? 440 : 780, easing: "cubic-bezier(.2,.6,.25,1)" },
      );
      leafAnimation.finished
        .then(() => {
          sheet.style.opacity = "0";
        })
        .catch(() => {});
      running.push(leafAnimation);
      const frontFace = sheet.querySelector<HTMLElement>(".folio-leaf-front");
      const backFace = sheet.querySelector<HTMLElement>(".folio-leaf-back");
      if (!isMobile && frontFace && backFace) {
        const frontFrames = [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: 0.49 },
          { opacity: 0, offset: 0.495 },
          { opacity: 0, offset: 1 },
        ];
        running.push(
          play(frontFace, frontFrames, {
            duration: 780,
            easing: "cubic-bezier(.2,.6,.25,1)",
          }),
        );
        running.push(
          play(
            backFace,
            frontFrames.map((frame) => ({
              ...frame,
              opacity: 1 - frame.opacity,
            })),
            { duration: 780, easing: "cubic-bezier(.2,.6,.25,1)" },
          ),
        );
      }
    }
    if (photo.current?.animate)
      running.push(
        play(photo.current, [{ opacity: 0.35 }, { opacity: 1 }], {
          duration: 480,
        }),
      );
    turnDirection.current = "next";
    return () => {
      if (sheet) sheet.style.opacity = "0";
      running.forEach((animation) => animation.cancel());
    };
  }, [venue.id, motionOff, isOpen, isMobile]);
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
                onClick={onShortlist}
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
            <button className="book-choose" type="button" onClick={onChoose}>
              <span>
                {chosen ? <Check size={16} /> : <ArrowDownLeft size={17} />}{" "}
                {chosen ? "At your table · review" : "Bring this to the table"}
              </span>
              <ArrowRight size={17} />
            </button>
            <button className="book-veto" type="button" onClick={onVeto}>
              <X size={12} /> Not this time · find another
            </button>
            <div className="book-page-number">
              <span>Something everyone can say yes to.</span>
              <span>{String(index * 2 + 2).padStart(2, "0")}</span>
            </div>
            <button
              type="button"
              className="folio-page-corner"
              onClick={nextRestaurant}
              aria-label="Turn this page"
              disabled={total < 2}
            >
              <span className="folio-corner-paper" aria-hidden="true" />
              <ChevronRight size={15} />
            </button>
          </section>
          <div className="book-spine" aria-hidden="true" />
          <div
            ref={turningSheet}
            className="folio-turn-sheet"
            aria-hidden="true"
          >
            <div className="folio-leaf-front">
              <span>COMMON TABLE · THE SUPPER EDITION</span>
              <b>{leafPrint.name}</b>
              <i>{leafPrint.cuisine}</i>
              <div className="folio-leaf-rule" />
              {leafPrint.menu.slice(0, 3).map((dish) => (
                <p key={dish.name}>
                  {dish.name}
                  <em>${dish.price}</em>
                </p>
              ))}
              <Utensils size={28} strokeWidth={1} />
            </div>
            <div className="folio-leaf-back">
              <span className="folio-back-imprint">
                COMMON TABLE · GOOD COMPANY
              </span>
              <img src={venue.image} alt="" />
              <b>A little off the beaten path.</b>
              <p>{venue.story || venue.description}</p>
              <Utensils size={24} strokeWidth={1} />
            </div>
          </div>
        </div>
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
