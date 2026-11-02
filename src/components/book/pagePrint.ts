import type { Venue } from "../../domain/types";
import { isDemoVenue, venuePriceLabel, venueRatingLabel, venueTravelLabel } from "../../domain/catalog";

/** A paint-only copy of the actual laid-out paper, never a second focus tree. */
export function pagePrint(
  source: HTMLElement,
  venue: Venue,
  index: number,
  side: "place" | "menu",
  current: boolean,
): HTMLElement {
  const leaf = document.createElement("div");
  leaf.className = "folio-curl-leaf";
  leaf.dataset.density = "soft";
  leaf.dataset.venue = venue.id;
  leaf.dataset.side = side;
  leaf.setAttribute("aria-hidden", "true");
  leaf.inert = true;
  const page = source.cloneNode(true) as HTMLElement;
  page.removeAttribute("hidden");
  page.style.removeProperty("display");
  page.classList.add("folio-printed-page");
  for (const element of [page, ...page.querySelectorAll<HTMLElement>("*")]) {
    for (const attr of [
      "id",
      "role",
      "aria-controls",
      "aria-labelledby",
      "tabindex",
    ])
      element.removeAttribute(attr);
    element.style.viewTransitionName = "none";
    if (element instanceof HTMLButtonElement) {
      element.tabIndex = -1;
      element.removeAttribute("aria-label");
    }
  }
  page.querySelector(".folio-page-corner")?.remove();
  // Keep resting-view selectors unique while reusing the same editorial styles.
  for (const [from, to] of [
    ["book-restaurant-title", "folio-print-title"],
    ["book-choose", "folio-print-action"],
    ["book-venue-photo", "folio-print-photo"],
  ]) {
    page.querySelectorAll(`.${from}`).forEach((el) => {
      el.classList.remove(from);
      el.classList.add(to);
    });
  }
  const text = (selector: string, value: string) => {
    const node = page.querySelector(selector);
    if (node) node.textContent = value;
  };
  if (!current) {
    if (side === "place") {
      const image = page.querySelector<HTMLImageElement>("img");
      if (image) {
        image.src = venue.image;
        image.alt = "";
      }
      text(".book-photo-caption", `${venue.neighborhood}${isDemoVenue(venue) ? ", Brooklyn" : ""}`);
      text(".book-mobile-venue-name", venue.name);
      text(".book-left-story > p", venue.story || venue.description);
      const details = page.querySelectorAll(".book-details > span");
      if (details[0])
        details[0].textContent = `★ ${venueRatingLabel(venue)}${isDemoVenue(venue) ? " · demo rating" : ""}`;
      if (details[1])
        details[1].textContent = `${venueTravelLabel(venue)}${isDemoVenue(venue) ? " · illustrative" : ""}`;
      if (details[2]) details[2].textContent = `${venuePriceLabel(venue)}${isDemoVenue(venue) ? " / person" : ""}`;
    } else {
      text(".folio-print-title h2", venue.name);
      text(".book-restaurant-cuisine", venue.cuisine);
      const oldMenu = page.querySelector(".book-menu-items, .book-real-notes");
      if (oldMenu) {
        const replacement = document.createElement(isDemoVenue(venue) ? 'ul' : 'div');
        replacement.className = isDemoVenue(venue) ? 'book-menu-items' : 'book-real-notes';
        if (isDemoVenue(venue)) {
          venue.menu.slice(0,3).forEach(dish => {
            const item=document.createElement('li'), row=document.createElement('div');row.className='book-dish-name';
            const name=document.createElement('h3');name.textContent=dish.name;
            const leader=document.createElement('span');leader.className='book-dotted-leader';
            const price=document.createElement('span');price.textContent=`$${dish.price}`;
            const description=document.createElement('p');description.textContent=dish.description;
            row.append(name,leader,price);item.append(row,description);replacement.append(item);
          });
        } else {
          const description=document.createElement('p');description.textContent=venue.description;
          const warning=document.createElement('p');warning.textContent='Menu, per-person cost, hours and dietary options need restaurant confirmation.';
          replacement.append(description,warning);
        }
        oldMenu.replaceWith(replacement);
      }
      text('.book-menu-heading > span:first-child',isDemoVenue(venue)?'A TASTE OF THE MENU':'BEFORE YOU GO');
      text('.book-menu-heading > span:last-child',isDemoVenue(venue)?'DEMO MENU':'RESTAURANT NOTES');
      text(".book-match-note p", isDemoVenue(venue) ? "An illustrative menu, ready for a closer look." : "A nearby place to explore together. Confirm cost and dietary needs.");
      text(".folio-print-action > span", "Bring this to the table");
      page.querySelector(".book-bookmark")?.classList.remove("is-saved");
      const bookmark = page.querySelector(".book-bookmark svg");
      bookmark?.setAttribute("fill", "none");
    }
  }
  text(
    ".book-page-number > span:last-child",
    String(index * 2 + (side === "place" ? 1 : 2)).padStart(2, "0"),
  );
  leaf.appendChild(page);
  return leaf;
}
