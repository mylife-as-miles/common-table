import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  MapPin,
  Sparkles,
  Star,
  Utensils,
  X,
} from "lucide-react";
import type { Venue } from "../domain/types";
import "./menu-book.css";

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
  const previousVenue = useRef(venue.id);
  const rightPage = useRef<HTMLElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const panelId = useId();
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
    if (previousVenue.current === venue.id) return;
    previousVenue.current = venue.id;
    if (
      lowPower ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animations: Animation[] = [];
    // Each new venue cancels the prior turn, including rapid next/previous clicks.
    if (rightPage.current?.animate)
      animations.push(
        rightPage.current.animate(
          [
            {
              transform: "perspective(1200px) rotateY(-11deg)",
              filter: "brightness(.88)",
            },
            {
              transform: "perspective(1200px) rotateY(0deg)",
              filter: "brightness(1)",
            },
          ],
          { duration: 580, easing: "cubic-bezier(.19,1,.22,1)" },
        ),
      );
    if (photo.current?.animate)
      animations.push(
        photo.current.animate([{ opacity: 0.3 }, { opacity: 1 }], {
          duration: 450,
        }),
      );
    return () => animations.forEach((animation) => animation.cancel());
  }, [venue.id, lowPower]);
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
    <div className={`menu-book-scene${lowPower ? " menu-book-low-power" : ""}`}>
      <div className="book-shadow" aria-hidden="true" />
      <div
        className="book-mobile-tabs"
        ref={tabs}
        role="tablist"
        aria-label="Restaurant book pages"
        hidden={!isMobile}
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
        <div className="book-pages">
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
          </section>
          <div className="book-spine" aria-hidden="true" />
        </div>
      </article>
      <div className="book-navigation" aria-label="Browse restaurant menus">
        <button
          type="button"
          onClick={onPrevious}
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
          onClick={onNext}
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
