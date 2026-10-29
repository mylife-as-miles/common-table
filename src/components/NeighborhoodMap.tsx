import { ArrowUpRight, MapPin, Plus, Minus } from "lucide-react";
import { useState } from "react";
import type { Venue } from "../domain/types";

interface Props {
  venues: Venue[];
  selected: Venue;
  onSelect: (id: string) => void;
  expanded?: boolean;
  onOpenMenu?: () => void;
}
export function NeighborhoodMap({
  venues,
  selected,
  onSelect,
  expanded = false,
  onOpenMenu,
}: Props) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className={`neighborhood-map ${expanded ? "map-expanded" : ""}`}>
      <div
        className="map-art"
        style={{ "--map-zoom": zoom } as React.CSSProperties}
      >
        <svg
          viewBox="0 0 400 340"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="blocks"
              width="46"
              height="37"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-26 200 170)"
            >
              <rect x="4" y="4" width="37" height="28" rx="2" fill="#d9d9c9" />
              <path d="M0 0H46M0 0V37" stroke="#fbf6e9" strokeWidth="6" />
            </pattern>
          </defs>
          <rect width="400" height="340" fill="#e8e7d9" />
          <rect width="400" height="340" fill="url(#blocks)" />
          <path d="M0 0H75L22 85 0 110Z" fill="#b6c8c6" />
          <path d="M217 55l42-20 35 70-43 20z" fill="#b5bd97" />
          <path
            d="M-20 248L420 49M-20 268L420 69"
            stroke="#faf7e9"
            strokeWidth="8"
          />
          <path d="M54 360L205-20" stroke="#f5efd9" strokeWidth="11" />
          <path
            d="M54 360L205-20"
            stroke="#c5ba9b"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <path
            d={`M183 254 L${selected.coordinates.x * 4 - 18} ${selected.coordinates.y * 3.4 + 22} L${selected.coordinates.x * 4} ${selected.coordinates.y * 3.4}`}
            stroke="#ac5b3e"
            strokeWidth="2"
            strokeDasharray="4 6"
            fill="none"
            opacity=".7"
          />
          <text
            x="77"
            y="115"
            transform="rotate(-26 77 115)"
            className="map-street"
          >
            MYRTLE AVE
          </text>
          <text
            x="264"
            y="264"
            transform="rotate(-26 264 264)"
            className="map-street"
          >
            FULTON ST
          </text>
          <text
            x="239"
            y="81"
            transform="rotate(-26 239 81)"
            className="map-park"
          >
            FORT GREENE
          </text>
          <text
            x="252"
            y="91"
            transform="rotate(-26 252 91)"
            className="map-park"
          >
            PARK
          </text>
        </svg>
        {venues.map((venue, i) => (
          <button
            key={venue.id}
            className={`map-marker ${selected.id === venue.id ? "selected" : ""}`}
            style={{
              left: `${venue.coordinates.x}%`,
              top: `${venue.coordinates.y}%`,
            }}
            onClick={() => onSelect(venue.id)}
            aria-label={`Explore ${venue.name}, pin ${i + 1}`}
            aria-pressed={selected.id === venue.id}
          >
            <span aria-hidden="true">
              {selected.id === venue.id ? <MapPin size={15} /> : i + 1}
            </span>
            {selected.id === venue.id && <b>{venue.name}</b>}
          </button>
        ))}
      </div>
      <div className="map-compass" aria-hidden="true">
        N<span>↑</span>
      </div>
      {expanded && (
        <div className="map-zoom">
          <button
            aria-label="Zoom in"
            disabled={zoom >= 1.4}
            onClick={() => setZoom((x) => Math.min(1.4, x + 0.2))}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => setZoom((x) => Math.max(1, x - 0.2))}
          >
            <Minus size={16} />
          </button>
        </div>
      )}
      <div className="map-caption">
        <span>
          <span className="status-dot" /> Illustrated neighborhood
        </span>
        {onOpenMenu && (
          <button onClick={onOpenMenu} aria-label="Expand neighborhood map">
            <ArrowUpRight size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
