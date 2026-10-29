import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BellRing,
  Bookmark,
  Check,
  Compass,
  Layers,
  List,
  MapPin,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  Sun,
  Users,
  Utensils,
  X,
} from "lucide-react";
import type { Participant, Venue } from "../domain/types";
import "./immersive-map.css";

export interface ImmersiveMapProps {
  venues: Venue[];
  selected: Venue;
  participants: Participant[];
  shortlist: string[];
  plannedVenueId: string | null;
  onSelect: (id: string) => void;
  onOpenMenu: () => void;
  onShortlist: () => void;
  onTable: () => void;
  onAskWaiter: () => void;
  lowPower: boolean;
}
const positions: Record<string, { x: number; y: number }> = {
  juniper: { x: 850, y: 490 },
  olive: { x: 1155, y: 415 },
  momo: { x: 665, y: 380 },
  casa: { x: 635, y: 755 },
  sunday: { x: 416, y: 480 },
  bomi: { x: 1130, y: 775 },
};
const site = (venue: Venue) =>
  positions[venue.id] || {
    x: 320 + venue.coordinates.x * 10,
    y: 170 + venue.coordinates.y * 7,
  };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const blocks = [
  [365, 165, 3, 38, 45],
  [540, 145, 4, 32, 39],
  [770, 152, 3, 43, 54],
  [986, 165, 4, 36, 40],
  [1182, 166, 3, 31, 49],
  [360, 310, 3, 32, 44],
  [550, 280, 3, 39, 49],
  [1010, 300, 3, 35, 42],
  [1200, 310, 3, 30, 46],
  [383, 440, 2, 38, 45],
  [565, 455, 3, 31, 43],
  [1010, 458, 3, 35, 42],
  [1200, 470, 2, 35, 49],
  [350, 608, 3, 36, 39],
  [554, 610, 4, 32, 47],
  [790, 618, 4, 29, 41],
  [1003, 615, 3, 39, 43],
  [1200, 620, 3, 30, 45],
  [380, 785, 3, 34, 42],
  [730, 788, 4, 32, 45],
  [1000, 795, 3, 35, 42],
  [1193, 795, 3, 30, 43],
];
const trees = [
  [760, 277],
  [804, 266],
  [849, 276],
  [897, 263],
  [940, 275],
  [745, 315],
  [925, 321],
  [757, 359],
  [931, 369],
  [791, 403],
  [837, 414],
  [885, 406],
  [818, 335],
  [872, 340],
  [292, 205],
  [303, 270],
  [292, 334],
  [316, 399],
  [305, 546],
  [328, 700],
  [455, 570],
  [715, 542],
  [926, 555],
  [1134, 555],
  [468, 862],
  [684, 870],
  [920, 860],
  [1145, 872],
];

function Brownstone({
  x,
  y,
  width,
  height,
  depth,
  tone,
  evening,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  tone: number;
  evening: boolean;
}) {
  const roof = ["#b8a183", "#d0c2a7", "#a6ad8d", "#bd9275", "#c0a988"][
    tone % 5
  ];
  return (
    <g className="atlas-building">
      <path
        d={`M${x + 5} ${y + height}l${width + 12} 0 22 ${depth + 12}-${width + 14} 0Z`}
        fill="#3d432a45"
      />
      <path
        d={`M${x + width} ${y}l7 7v${height + depth - 7}l-7 -${depth}Z`}
        fill="#9b8f72"
      />
      <path
        d={`M${x} ${y + height}h${width}v${depth}h-${width}Z`}
        fill={tone % 2 ? "#a88165" : "#aba080"}
        stroke="#a68d6e"
        strokeWidth=".7"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={roof}
        stroke="#eee3ca"
        strokeWidth="2"
      />
      <rect
        x={x + 5}
        y={y + 5}
        width={width - 10}
        height={height - 10}
        fill="none"
        stroke="#8e826445"
      />
      <rect x={x + width - 12} y={y + 7} width="6" height="8" fill="#8f8067" />
      {[7, width - 12].map((offset, i) => (
        <rect
          key={i}
          x={x + offset}
          y={y + height + 5}
          width="5"
          height="7"
          fill={evening ? "#f9d78a" : "#77795e"}
        />
      ))}
      {depth > 25 && (
        <>
          <rect
            x={x + 7}
            y={y + height + 17}
            width="5"
            height="6"
            fill={evening ? "#f6d697" : "#77795e"}
          />
          <rect
            x={x + width - 12}
            y={y + height + 17}
            width="5"
            height="6"
            fill={evening ? "#f6d697" : "#77795e"}
          />
        </>
      )}
    </g>
  );
}

function AtlasGeography({
  selected,
  evening,
  flat,
  tableCount,
}: {
  selected: Venue;
  evening: boolean;
  flat: boolean;
  tableCount: number;
}) {
  const p = site(selected);
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`atlas-geography${flat ? " atlas-geography-flat" : ""}`}
      viewBox="0 0 1440 1000"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#8caeb2" />
          <stop offset="1" stopColor="#b8cfc5" />
        </linearGradient>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e8e5d1" />
          <stop offset="1" stopColor="#d7d4b9" />
        </linearGradient>
        <pattern
          id={`${id}-ripple`}
          width="45"
          height="30"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M4 15q9-5 18 0t18 0"
            stroke="#e7eeDE"
            strokeWidth=".8"
            fill="none"
            opacity=".35"
          />
        </pattern>
        <filter id={`${id}-grain`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".8"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".055" />
          </feComponentTransfer>
          <feBlend in="SourceGraphic" mode="multiply" />
        </filter>
      </defs>
      <path
        d="M50 94H1388V922H50Z"
        fill="#62654b"
        transform="translate(9 15)"
      />
      <rect
        x="50"
        y="88"
        width="1340"
        height="830"
        rx="3"
        fill={`url(#${id}-land)`}
        stroke="#f5efd9"
        strokeWidth="7"
      />
      <path
        d="M53 91H295L282 154 304 205 288 273 302 336 319 400 303 465 329 534 321 608 344 690 327 757 352 830 354 914H53Z"
        fill={`url(#${id}-water)`}
      />
      <path
        d="M53 91H295L282 154 304 205 288 273 302 336 319 400 303 465 329 534 321 608 344 690 327 757 352 830 354 914H53Z"
        fill={`url(#${id}-ripple)`}
      />
      <path
        d="M295 91L282 154 304 205 288 273 302 336 319 400 303 465 329 534 321 608 344 690 327 757 352 830 354 914"
        fill="none"
        stroke="#f8f3df"
        strokeWidth="17"
      />
      <path
        d="M295 91L282 154 304 205 288 273 302 336 319 400 303 465 329 534 321 608 344 690 327 757 352 830 354 914"
        fill="none"
        stroke="#a8af91"
        strokeWidth="2"
        strokeDasharray="2 6"
      />
      <g fill="#b0a68a" stroke="#e7debf" strokeWidth="2">
        <path d="M290 234H177v26h115Z" />
        <path d="M305 375H143v30h169Z" />
        <path d="M326 644H202v23h131Z" />
        <path d="M341 805H219v22h126Z" />
      </g>
      <g stroke="#e7ddc2" strokeWidth="1" opacity=".8">
        <path d="M184 236v22m12-22v22m12-22v22m12-22v22m12-22v22m12-22v22m12-22v22m12-22v22M152 379v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23m13-23v23" />
      </g>
      <g stroke="#bfc0a655" strokeWidth="37" fill="none">
        <path d="M320 258L1369 258M333 413L1369 413M327 574L1369 574M345 745L1369 745M510 102V904M721 102V904M971 102V904M1173 102V904" />
      </g>
      <g stroke="#f9f3df" strokeWidth="27" fill="none">
        <path d="M320 258L1369 258M333 413L1369 413M327 574L1369 574M345 745L1369 745M510 102V904M721 102V904M971 102V904M1173 102V904" />
      </g>
      <path d="M335 893L1338 104" stroke="#c3bfa1" strokeWidth="45" />
      <path d="M335 893L1338 104" stroke="#faf4df" strokeWidth="37" />
      <path
        d="M335 893L1338 104"
        stroke="#c4b48e"
        strokeWidth="1"
        strokeDasharray="6 8"
      />
      <path
        d="M748 235H948V420H748Z"
        fill="#bec49c"
        stroke="#a7b086"
        strokeWidth="2"
      />
      <path
        d="M754 243H941V413H754Z"
        fill="none"
        stroke="#e3e3bd"
        strokeWidth="5"
      />
      <path
        d="M756 246L936 409M938 247L758 410"
        stroke="#ece6c8"
        strokeWidth="8"
      />
      <ellipse
        cx="846"
        cy="328"
        rx="25"
        ry="20"
        fill="#d2d4ae"
        stroke="#ece6c8"
        strokeWidth="5"
      />
      <ellipse cx="846" cy="328" rx="10" ry="7" fill="#abbfba" />
      <g>
        {blocks.map(([x, y, count, width, height], row) =>
          Array.from({ length: count }, (_, i) => (
            <Brownstone
              key={`${row}-${i}`}
              x={x + i * (width + 5)}
              y={y + (i % 2) * 3}
              width={width}
              height={height}
              depth={flat ? 3 : 18 + ((row + i) % 3) * 7}
              tone={row + i}
              evening={evening}
            />
          )),
        )}
      </g>
      <g className="atlas-bridge" transform="rotate(-28 215 325)">
        <path
          d="M35 348H453"
          stroke="#6c765642"
          strokeWidth="30"
          transform="translate(12 17)"
        />
        <path d="M35 343H453" stroke="#8f9674" strokeWidth="24" />
        <path d="M35 340H453" stroke="#e2d7b6" strokeWidth="16" />
        <path
          d="M35 340H453"
          stroke="#a69772"
          strokeDasharray="8 5"
          strokeWidth="1"
        />
        <path
          d="M37 334Q98 331 155 264Q240 359 328 264Q393 331 451 334"
          stroke="#6e7755"
          strokeWidth="3"
          fill="none"
        />
        <path
          d="M37 346Q98 343 155 276Q240 371 328 276Q393 343 451 346"
          stroke="#89916c"
          strokeWidth="2"
          fill="none"
        />
        {[155, 328].map((x, i) => (
          <g key={i}>
            <path
              d={`M${x - 15} 258h30v94h-10v-49q-5-14-10 0v49h-10Z`}
              fill="#b8ac88"
              stroke="#8b8a68"
              strokeWidth="1.5"
            />
            <path
              d={`M${x - 18} 256h36v8h-36Z`}
              fill="#d3c7a4"
              stroke="#8b8a68"
              strokeWidth="1"
            />
            <path d={`M${x + 15} 264l7 7v81h-7Z`} fill="#93926f" />
            <rect x={x - 3} y="272" width="6" height="9" fill="#727e5d" />
          </g>
        ))}
        <path
          d="M76 329v14m23-26v26m22-46v46m70-33v33m24-18v18m25-13v13m25-15v15m24-28v28m77-37v37m24-23v23m23-14v14"
          stroke="#7d8665"
          strokeWidth="1"
        />
        <text
          x="240"
          y="386"
          textAnchor="middle"
          className="atlas-bridge-label"
        >
          BROOKLYN BRIDGE
        </text>
      </g>
      <g className="atlas-landmark">
        <path d="M796 447h113v78H796Z" fill="#bab293" />
        <path
          d="M803 452h99v58h-99Z"
          fill="#8f9577"
          stroke="#dfd6ba"
          strokeWidth="4"
        />
        <path d="M795 518h115v18H795Z" fill="#b3a082" />
        <path
          d="M817 512v20m20-20v20m20-20v20m20-20v20m20-20v20"
          stroke="#e8dcc0"
          strokeWidth="6"
        />
        <path d="M796 447l56-29 57 29Z" fill="#a0a384" />
        <rect x="842" y="430" width="20" height="17" fill="#d4c8a8" />
        <circle cx="852" cy="437" r="5" fill="#6c7759" />
        <text
          x="853"
          y="550"
          textAnchor="middle"
          className="atlas-landmark-label"
        >
          THE NEIGHBORHOOD HALL
        </text>
      </g>
      <g>
        {trees.map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x + 6} cy={y + 9} rx="17" ry="9" fill="#596c3c28" />
            <path d={`M${x} ${y}v14`} stroke="#8e8964" strokeWidth="3" />
            <ellipse
              cx={x}
              cy={y - (flat ? 0 : 7)}
              rx={i % 3 === 0 ? 17 : 13}
              ry={flat ? 9 : 15}
              fill={["#86966b", "#9daa7e", "#73865d"][i % 3]}
            />
            <ellipse
              cx={x - 4}
              cy={y - (flat ? 2 : 11)}
              rx="8"
              ry="7"
              fill="#c6cc9a"
              opacity=".4"
            />
          </g>
        ))}
      </g>
      <g className="atlas-map-labels">
        <text
          x="174"
          y="574"
          textAnchor="middle"
          transform="rotate(-90 174 574)"
          className="atlas-water-label"
        >
          EAST RIVER
        </text>
        <text x="421" y="132">
          DUMBO
        </text>
        <text x="1046" y="130">
          CLINTON HILL
        </text>
        <text x="861" y="221" textAnchor="middle">
          FORT GREENE PARK
        </text>
        <text x="620" y="714">
          BOERUM HILL
        </text>
        <text x="1100" y="705">
          DOWNTOWN
        </text>
        <text x="1173" y="731">
          BROOKLYN
        </text>
        <text x="1000" y="565" className="atlas-street-label">
          MYRTLE AVENUE
        </text>
        <text x="404" y="403" className="atlas-street-label">
          WATER STREET
        </text>
        <text x="760" y="735" className="atlas-street-label">
          FULTON STREET
        </text>
        <text x="223" y="354" className="atlas-street-label">
          PIER 01
        </text>
      </g>
      <path
        d={`M${p.x} ${p.y + 8}Q${p.x - 70} ${p.y + 100} 690 574L510 574L510 642L465 642`}
        className="atlas-table-route"
        fill="none"
        stroke="#ae684b"
        strokeWidth="3"
        strokeDasharray="5 8"
      />
      <g transform="translate(444 642)">
        <ellipse rx="40" ry="26" fill="#515f3e20" transform="translate(7 10)" />
        <ellipse
          rx="36"
          ry="24"
          fill="#c9b78c"
          stroke="#f5e7c5"
          strokeWidth="4"
        />
        <ellipse rx="24" ry="16" fill="#a08f68" />
        <circle cx="-16" cy="-4" r="6" fill="#f6f0da" />
        <circle cx="15" cy="4" r="6" fill="#f6f0da" />
        <circle cy="-2" r="4" fill="#637850" />
        <text x="0" y="50" textAnchor="middle" className="atlas-table-label">
          YOUR TABLE · {tableCount} {tableCount === 1 ? "SEAT" : "SEATS"}
        </text>
      </g>
      <g pointerEvents="none">
        <path
          d="M493 92V915M939 92V915"
          stroke="#7a705a"
          strokeWidth="2"
          opacity=".1"
        />
        <path
          d="M496 92V915M942 92V915"
          stroke="#fffdf1"
          strokeWidth="4"
          opacity=".45"
        />
        <path d="M52 507H1388" stroke="#948b71" strokeWidth="2" opacity=".08" />
        <path d="M52 510H1388" stroke="#fffdf1" strokeWidth="4" opacity=".3" />
      </g>
      <rect
        className="atlas-paper-grain"
        x="53"
        y="91"
        width="1334"
        height="824"
        fill="transparent"
        filter={`url(#${id}-grain)`}
        opacity=".4"
        pointerEvents="none"
      />
    </svg>
  );
}

export default function ImmersiveMap({
  venues,
  selected,
  participants,
  shortlist,
  plannedVenueId,
  onSelect,
  onOpenMenu,
  onShortlist,
  onTable,
  onAskWaiter,
  lowPower,
}: ImmersiveMapProps) {
  const stage = useRef<HTMLDivElement>(null);
  const listToggle = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [scale, setScale] = useState(0.9);
  const [tilted, setTilted] = useState(true);
  const [evening, setEvening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const listId = useId();
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.max(0.49, Math.min(1.05, entry.contentRect.width / 1440))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const p = site(selected);
    setPan({
      x: clamp((840 - p.x) * scale, -280, 280),
      y: clamp((470 - p.y) * scale * 0.65, -170, 170),
    });
  }, [selected.id, scale]);
  useEffect(() => {
    if (listOpen)
      listRef.current
        ?.querySelector<HTMLButtonElement>(".atlas-list-venue")
        ?.focus();
  }, [listOpen]);
  const flat = lowPower || reducedMotion || !tilted;
  const reset = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };
  const nudge = (x: number, y: number) =>
    setPan((p) => ({
      x: clamp(p.x + x, -550, 550),
      y: clamp(p.y + y, -340, 340),
    }));
  const closeList = () => {
    setListOpen(false);
    requestAnimationFrame(() => listToggle.current?.focus());
  };
  const keyPan = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const movements: Record<string, [number, number]> = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    };
    if (movements[event.key]) {
      event.preventDefault();
      nudge(...movements[event.key]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((z) => clamp(Math.round((z + 0.15) * 100) / 100, 0.7, 1.6));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((z) => clamp(Math.round((z - 0.15) * 100) / 100, 0.7, 1.6));
    } else if (event.key === "Home") {
      event.preventDefault();
      reset();
    }
  };
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("button,a,input,aside")
    )
      return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x,
      dy = event.clientY - drag.current.y;
    if (Math.hypot(dx, dy) < 5) return;
    setDragging(true);
    setPan({
      x: clamp(drag.current.pan.x + dx, -550, 550),
      y: clamp(drag.current.pan.y + dy, -340, 340),
    });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const sharedTastes = Array.from(
    new Set(participants.flatMap((p) => p.tastes)),
  )
    .filter((taste) =>
      selected.tags.some((tag) => tag.toLowerCase() === taste.toLowerCase()),
    )
    .slice(0, 2);
  const allFit = participants.every(
    (p) =>
      p.budget >= selected.price &&
      p.restrictions.every((r) => selected.dietary.includes(r)),
  );
  const activeStyle = {
    "--atlas-scale": scale * zoom,
    "--pin-scale": 1 / scale,
    "--atlas-pan-x": `${pan.x}px`,
    "--atlas-pan-y": `${pan.y}px`,
  } as CSSProperties;
  return (
    <section
      className={`immersive-atlas ${evening ? "atlas-evening" : ""} ${flat ? "atlas-flat" : ""} ${dragging ? "atlas-dragging" : ""} ${lowPower || reducedMotion ? "atlas-still" : ""}`}
      aria-label="Interactive illustrated Brooklyn supper atlas"
    >
      <div
        className="atlas-viewport"
        ref={stage}
        tabIndex={0}
        onKeyDown={keyPan}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        aria-label="Map canvas. Drag to explore. Arrow keys pan, plus and minus zoom, Home resets. Restaurant list offers the same venues."
      >
        <div className="atlas-world" style={activeStyle}>
          <AtlasGeography
            selected={selected}
            evening={evening}
            flat={flat}
            tableCount={participants.length}
          />
          {venues.map((venue, i) => {
            const p = site(venue),
              active = selected.id === venue.id;
            return (
              <button
                key={venue.id}
                className={`atlas-photo-pin ${active ? "atlas-pin-selected" : ""} ${plannedVenueId === venue.id ? "atlas-pin-planned" : ""}`}
                style={
                  {
                    left: p.x,
                    top: p.y,
                    "--pin-accent": venue.accent,
                  } as CSSProperties
                }
                onClick={() => onSelect(venue.id)}
                onFocus={(event) => {
                  if (!event.currentTarget.matches(":focus-visible")) return;
                  setPan({
                    x: clamp((800 - p.x) * scale * zoom, -550, 550),
                    y: clamp((470 - p.y) * scale * zoom * 0.65, -340, 340),
                  });
                  // Keep keyboard focus within our camera system, rather than scrolling
                  // the overflow container independently of its visible map controls.
                  requestAnimationFrame(() => stage.current?.scrollTo(0, 0));
                }}
                aria-pressed={active}
              >
                <span className="sr-only">Explore </span>
                <span className="atlas-pin-photo">
                  <img
                    src={venue.image}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                  {shortlist.includes(venue.id) && (
                    <span className="atlas-pin-bookmarked">
                      <Bookmark size={11} fill="currentColor" />
                    </span>
                  )}
                  <span className="atlas-pin-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </span>
                <span className="atlas-pin-caption">
                  <strong>{venue.name}</strong>
                  <small>
                    {active
                      ? `${venue.cuisine.split(" · ")[0]} · $${venue.price}`
                      : `$${venue.price} / person`}
                  </small>
                </span>
                {active && (
                  <span className="atlas-pin-fit">
                    <span />
                    {allFit
                      ? "A fit for your table"
                      : "Review table preferences"}
                  </span>
                )}
                <span className="atlas-pin-stem" aria-hidden="true" />
                <span className="atlas-pin-ground" aria-hidden="true" />
              </button>
            );
          })}
          <button
            className="atlas-table-token"
            style={{ left: 444, top: 642 }}
            onClick={onTable}
            aria-label={`Visit your shared table, ${participants.length} ${participants.length === 1 ? "seat" : "seats"}`}
          >
            <Utensils size={17} />
          </button>
        </div>
        <div className="atlas-light" aria-hidden="true" />
      </div>
      <header className="atlas-heading">
        <span className="atlas-edition">
          <span />{" "}
          <span className="atlas-desktop-title">THE BROOKLYN SUPPER ATLAS</span>
          <span className="atlas-mobile-title">YOUR BROOKLYN ATLAS</span>{" "}
          <i>VOL. 01</i>
        </span>
        <h2>
          A neighborhood.
          <br />
          <em>A thousand possibilities.</em>
        </h2>
        <p>Follow your appetite. Find your people.</p>
      </header>
      <div className="atlas-top-tools">
        <button
          type="button"
          onClick={() => setEvening((v) => !v)}
          aria-label={
            evening
              ? "Evening · Switch to daylight"
              : "Golden hour · Switch to evening light"
          }
          aria-pressed={evening}
        >
          {evening ? <Moon size={15} /> : <Sun size={16} />}
          <span>{evening ? "Evening" : "Golden hour"}</span>
        </button>
        <button
          type="button"
          onClick={() => setTilted((v) => !v)}
          aria-label={
            flat ? "2D · Switch to dimensional map" : "3D · Switch to flat map"
          }
          aria-pressed={!flat}
          disabled={lowPower || reducedMotion}
        >
          <Layers size={15} />
          <span>{flat ? "2D" : "3D"}</span>
        </button>
        <button
          type="button"
          className="atlas-list-toggle"
          ref={listToggle}
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
          aria-controls={listId}
        >
          <List size={16} />
          <span>
            Places <b>{venues.length}</b>
          </span>
        </button>
      </div>
      <div className="atlas-compass">
        <button
          type="button"
          onClick={reset}
          aria-label="Reset map view to north"
        >
          <span>N</span>
          <Compass size={33} strokeWidth={1} />
        </button>
        <span>SCHEMATIC NORTH</span>
      </div>
      <article
        className="atlas-postcard"
        aria-label={`${selected.name}, selected restaurant`}
      >
        <div className="atlas-postcard-top">
          <span>
            <MapPin size={11} /> {selected.neighborhood}
          </span>
          <span>THE NEXT CHAPTER</span>
          <button
            type="button"
            onClick={onShortlist}
            aria-label={
              shortlist.includes(selected.id)
                ? `Remove ${selected.name} from shortlist`
                : `Save ${selected.name} to shortlist`
            }
            aria-pressed={shortlist.includes(selected.id)}
          >
            <Bookmark
              size={17}
              fill={shortlist.includes(selected.id) ? "currentColor" : "none"}
            />
          </button>
        </div>
        <div className="atlas-postcard-venue">
          <img
            className="atlas-selected-photo"
            style={{ viewTransitionName: "venue-photo" }}
            src={selected.image}
            alt={`Illustrative dining atmosphere for ${selected.name}`}
          />
          <div>
            <h3 style={{ viewTransitionName: "venue-title" }}>
              {selected.name}
            </h3>
            <p>{selected.cuisine}</p>
            <span>
              ${selected.price} <small>per person · demo</small>
            </span>
          </div>
        </div>
        <div className="atlas-fit-strip">
          <button
            type="button"
            className="atlas-taste-avatars"
            onClick={onTable}
            title="Edit your table preferences"
          >
            <span className="sr-only">Edit your table preferences: </span>
            {participants.slice(0, 3).map((person) => (
              <i
                key={person.id}
                style={{ background: person.color }}
                title={person.name}
              >
                {person.name.slice(0, 1).toUpperCase()}
              </i>
            ))}
          </button>
          <div>
            <b>
              {participants.length === 1
                ? "Made room for your tastes"
                : `${participants.length} tastes at this table`}
            </b>
            <span>
              {sharedTastes.length
                ? sharedTastes.join(" + ")
                : "A new taste to explore"}{" "}
              {allFit ? "· budget fits" : "· review preferences"}
            </span>
          </div>
          <button
            type="button"
            className="atlas-ask-waiter"
            onClick={onAskWaiter}
          >
            <BellRing size={15} strokeWidth={1.4} />
            <span>
              Ask
              <br />
              <b>The Waiter</b>
            </span>
          </button>
        </div>
        <button type="button" className="atlas-open-menu" onClick={onOpenMenu}>
          <span>Open the menu</span>
          <ArrowRight size={17} />
        </button>
      </article>
      <div className="atlas-right-dock">
        <div className="atlas-camera-tools">
          <div className="atlas-zoom">
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= 1.6}
              onClick={() =>
                setZoom((z) =>
                  clamp(Math.round((z + 0.15) * 100) / 100, 0.7, 1.6),
                )
              }
            >
              <Plus size={19} />
            </button>
            <span aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 0.7}
              onClick={() =>
                setZoom((z) =>
                  clamp(Math.round((z - 0.15) * 100) / 100, 0.7, 1.6),
                )
              }
            >
              <Minus size={19} />
            </button>
          </div>
          <div className="atlas-pan-pad" aria-label="Pan map">
            <button
              type="button"
              aria-label="Pan map up"
              onClick={() => nudge(0, 65)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              aria-label="Pan map left"
              onClick={() => nudge(65, 0)}
            >
              <ArrowLeft size={15} />
            </button>
            <button type="button" aria-label="Reset map camera" onClick={reset}>
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              aria-label="Pan map right"
              onClick={() => nudge(-65, 0)}
            >
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              aria-label="Pan map down"
              onClick={() => nudge(0, -65)}
            >
              <ArrowDown size={15} />
            </button>
          </div>
        </div>
      </div>
      <div className="atlas-map-note">
        <span>
          <i /> Illustrated demo · fictional places · no location tracking
        </span>
        <p>Schematic connection: this place → your shared table.</p>
        <span className="atlas-drag-hint">
          Drag to explore · arrow keys pan <span>↔</span>
        </span>
      </div>
      {listOpen && (
        <aside
          className="atlas-places-list"
          ref={listRef}
          id={listId}
          aria-label="Restaurants on this map"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeList();
            }
          }}
        >
          <div className="atlas-list-heading">
            <div>
              <span>THE NEIGHBORHOOD INDEX</span>
              <h3>A place for every appetite.</h3>
            </div>
            <button
              type="button"
              onClick={closeList}
              aria-label="Close restaurant list"
            >
              <X size={19} />
            </button>
          </div>
          <p>
            The same demo places, in a list. Select one to find it on the atlas.
          </p>
          <ul>
            {venues.map((venue, i) => (
              <li key={venue.id}>
                <button
                  type="button"
                  className="atlas-list-venue"
                  onClick={() => {
                    onSelect(venue.id);
                    closeList();
                  }}
                  aria-pressed={venue.id === selected.id}
                >
                  <span className="atlas-list-number">0{i + 1}</span>
                  <img src={venue.image} alt="" />
                  <span>
                    <strong>{venue.name}</strong>
                    <small>
                      {venue.cuisine} · ${venue.price} / person
                    </small>
                  </span>
                  {venue.id === selected.id ? (
                    <Check size={16} />
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="atlas-list-table" onClick={onTable}>
            <Users size={15} /> Adjust the table’s tastes{" "}
            <ArrowRight size={16} />
          </button>
        </aside>
      )}
    </section>
  );
}
export { ImmersiveMap };
