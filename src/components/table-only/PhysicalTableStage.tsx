import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Participant } from "../../domain";
import projections from "./projections.json";

type Point = [number, number];
type SeatProjection = { plate: Point; card: Point[] };
type Projection = { width: number; height: number; seats: SeatProjection[] };
const source = projections as unknown as Record<string, Projection>;

/** Map a live text plane to the four corners of the actual rendered tent card. */
function cardTransform(points: Point[], width: number, height: number) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g =
    Math.abs(determinant) < 1e-8 ? 0 : (dx3 * dy2 - dx2 * dy3) / determinant;
  const h =
    Math.abs(determinant) < 1e-8 ? 0 : (dx1 * dy3 - dx3 * dy1) / determinant;
  const a = x1 - x0 + g * x1,
    b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1,
    e = y3 - y0 + h * y3;
  return `matrix3d(${[a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, x0, y0, 0, 1].join(",")})`;
}

interface PhysicalTableStageProps {
  participants: Participant[];
  editingId: string;
  arrivingId: string | null;
  onSelect: (id: string) => void;
  lowPower: boolean;
}

export function PhysicalTableStage({
  participants,
  editingId,
  arrivingId,
  onSelect,
  lowPower,
}: PhysicalTableStageProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [loaded, setLoaded] = useState(0);
  const count = Math.min(6, Math.max(1, participants.length));
  const projection = source[String(count)];
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="ct-physical-frame"
      ref={frame}
      data-seats={count}
      data-image-loaded={loaded === count}
      data-static={lowPower || undefined}
    >
      <img
        className="ct-table-render"
        src={`/images/table/table-${count}.webp`}
        width={projection.width}
        height={projection.height}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(count)}
      />
      <div
        className="tp-table-top ct-physical-controls"
        role="group"
        aria-label={`Your table has ${count} ${count === 1 ? "seat" : "seats"}`}
        aria-describedby="table-seat-hint"
      >
        {participants.map((person, index) => {
          const seat = projection.seats[index];
          if (!seat) return null;
          const targetSize = Math.max(44, width * 0.115);
          const x = seat.plate[0] * width,
            y = seat.plate[1] * width;
          const points = seat.card.map(
            ([cx, cy]) =>
              [
                cx * width - x + targetSize / 2,
                cy * width - y + targetSize / 2,
              ] as Point,
          );
          const style = {
            left: `${seat.plate[0] * 100}%`,
            top: `${seat.plate[1] * 100}%`,
            width: targetSize,
            height: targetSize,
          } as CSSProperties;
          return (
            <button
              id={`seat-${person.id}`}
              key={person.id}
              className={`tp-seat ct-physical-seat ${editingId === person.id ? "is-active" : ""} ${arrivingId === person.id ? "ct-seat-arriving" : ""}`}
              style={style}
              aria-label={`${person.name}${index > 0 ? " DEMO GUEST" : ""} — Edit ${person.name}'s tastes`}
              aria-pressed={editingId === person.id}
              onClick={() => onSelect(person.id)}
            >
              <span className="ct-seat-contact" aria-hidden="true" />
              <span
                className="tp-seat-name ct-physical-card"
                style={{ transform: cardTransform(points, 180, 60) }}
              >
                <span className="tp-seat-label">{person.name}</span>
                {index > 0 && <small aria-hidden="true">DEMO GUEST</small>}
                {editingId === person.id && (
                  <span className="ct-place-card-rule" aria-hidden="true" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
