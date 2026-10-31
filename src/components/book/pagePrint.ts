import type { Venue } from "../../domain/types";

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
      text(".book-photo-caption", `${venue.neighborhood}, Brooklyn`);
      text(".book-mobile-venue-name", venue.name);
      text(".book-left-story > p", venue.story || venue.description);
      const details = page.querySelectorAll(".book-details > span");
      if (details[0])
        details[0].textContent = `★ ${venue.rating.toFixed(1)} · demo rating`;
      if (details[1])
        details[1].textContent = `${venue.walkMinutes} min walk · illustrative`;
      if (details[2]) details[2].textContent = `$${venue.price} / person`;
    } else {
      text(".folio-print-title h2", venue.name);
      text(".book-restaurant-cuisine", venue.cuisine);
      const items = page.querySelectorAll(".book-menu-items > li");
      venue.menu.slice(0, 3).forEach((dish, i) => {
        const item = items[i];
        if (!item) return;
        const name = item.querySelector("h3");
        if (name) name.textContent = dish.name;
        const price = item.querySelector(".book-dish-name > span:last-child");
        if (price) price.textContent = `$${dish.price}`;
        const description = item.querySelector("p");
        if (description) description.textContent = dish.description;
      });
      text(
        ".book-match-note p",
        "An illustrative menu, ready for a closer look.",
      );
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
