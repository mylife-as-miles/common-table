import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, RotateCcw } from "lucide-react";
import "./printing-press.css";
import { playInteractionSound } from "../experience/interactionSound";

interface PrintingPressProps {
  children: ReactNode;
  saved: boolean;
  ready: boolean;
  jobKey: string;
  request: number;
  lowPower?: boolean;
  storageAvailable: boolean;
  onOperate: () => void;
  onReprint: () => void;
}
type Phase = "idle" | "printing" | "printed";
function gearTeeth() {
  return Array.from({ length: 48 }, (_, i) => {
    const angle = (i / 48) * Math.PI * 2;
    const radius = i % 4 === 0 || i % 4 === 3 ? 28 : 24;
    return `${32 + Math.cos(angle) * radius},${32 + Math.sin(angle) * radius}`;
  }).join(" ");
}
function Gear({ className }: { className: string }) {
  return (
    <svg
      className={`pp-gear ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <polygon
        points={gearTeeth()}
        fill="currentColor"
        stroke="#ead7a0"
        strokeWidth=".6"
      />
      <circle
        cx="32"
        cy="32"
        r="17"
        fill="#394437"
        stroke="#c4b17a"
        strokeWidth="2"
      />
      <path
        d="M32 15V49M15 32H49M20 20L44 44M20 44L44 20"
        stroke="currentColor"
        strokeWidth="5"
      />
      <circle
        cx="32"
        cy="32"
        r="6"
        fill="#e1ca88"
        stroke="#736545"
        strokeWidth="2"
      />
    </svg>
  );
}

/** Original CSS/SVG letterpress. A visual cycle never performs a save or export. */
export function PrintingPress({
  children,
  saved,
  ready,
  jobKey,
  request,
  lowPower = false,
  storageAvailable,
  onOperate,
  onReprint,
}: PrintingPressProps) {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [phase, setPhase] = useState<Phase>(saved ? "printed" : "idle");
  const previous = useRef({ request, jobKey });
  const pressRoot = useRef<HTMLDivElement>(null);
  const tearHandle = useRef<HTMLButtonElement>(null);
  const pull = useRef<{
    pointerId: number;
    startY: number;
    distance: number;
    moved: boolean;
  } | null>(null);
  const suppressPointerClick = useRef(false);
  const [detached, setDetached] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullPixels, setPullPixels] = useState(0);
  const [tearMessage, setTearMessage] = useState("");
  useEffect(() => {
    const held = pull.current;
    pull.current = null;
    if (held && tearHandle.current?.hasPointerCapture(held.pointerId))
      tearHandle.current.releasePointerCapture(held.pointerId);
    setDetached(false);
    setPulling(false);
    setPullPixels(0);
    setTearMessage("");
    suppressPointerClick.current = false;
  }, [jobKey, request, saved]);
  useEffect(
    () => () => {
      const held = pull.current;
      pull.current = null;
      if (held && tearHandle.current?.hasPointerCapture(held.pointerId))
        tearHandle.current.releasePointerCapture(held.pointerId);
    },
    [],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const newRequest = previous.current.request !== request;
    const changedJob = previous.current.jobKey !== jobKey;
    previous.current = { request, jobKey };
    if (!saved || (changedJob && !newRequest)) {
      setPhase(saved ? "printed" : "idle");
      return;
    }
    if (newRequest) {
      playInteractionSound("press");
      if (matchMedia("(max-width: 620px)").matches)
        pressRoot.current?.scrollIntoView({
          block: "start",
          behavior: lowPower || reducedMotion ? "instant" : "smooth",
        });
    }
    if (lowPower || reducedMotion) {
      setPhase("printed");
      return;
    }
    if (!newRequest) return;
    setPhase("printing");
    const timer = setTimeout(() => setPhase("printed"), 1700);
    return () => clearTimeout(timer);
  }, [request, jobKey, saved, lowPower, reducedMotion]);
  const printing = phase === "printing";
  function detachReceipt() {
    if (!saved || printing || detached) return;
    setDetached(true);
    setPulling(false);
    setPullPixels(0);
    setTearMessage(
      "Your current dinner plan is on the table. This was a visual tear only; nothing was saved again, downloaded, or sent.",
    );
    playInteractionSound("page");
  }
  function beginPull(event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      !saved ||
      printing ||
      detached ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    pull.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      distance: 0,
      moved: false,
    };
    suppressPointerClick.current = false;
    setPulling(true);
    setTearMessage("");
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePull(event: ReactPointerEvent<HTMLButtonElement>) {
    const held = pull.current;
    if (!held || held.pointerId !== event.pointerId) return;
    held.distance = Math.max(0, event.clientY - held.startY);
    held.moved ||= Math.abs(event.clientY - held.startY) > 4;
    const resisted = 72 * (1 - Math.exp(-held.distance / 100));
    setPullPixels(Math.min(70, resisted));
  }
  function finishPull(
    event: ReactPointerEvent<HTMLButtonElement>,
    cancel = false,
  ) {
    const held = pull.current;
    if (!held || held.pointerId !== event.pointerId) return;
    pull.current = null;
    suppressPointerClick.current = !cancel && held.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPulling(false);
    setPullPixels(0);
    if (!cancel && held.distance >= 96) detachReceipt();
    else if (held.moved || cancel)
      setTearMessage(
        cancel
          ? "Pull cancelled. The current receipt stays attached."
          : "A little more pull will tear it free. This short pull sprang back; your saved plan is unchanged.",
      );
  }
  function cancelActivePull() {
    const held = pull.current;
    if (!held) return false;
    pull.current = null;
    suppressPointerClick.current = true;
    setPulling(false);
    setPullPixels(0);
    if (tearHandle.current?.hasPointerCapture(held.pointerId))
      tearHandle.current.releasePointerCapture(held.pointerId);
    setTearMessage("Pull cancelled. The current receipt stays attached.");
    return true;
  }
  return (
    <div
      ref={pressRoot}
      className={`printing-press ${lowPower || reducedMotion ? "pp-still" : ""}`}
      data-phase={phase}
      data-paper={detached ? "detached" : pulling ? "pulling" : "attached"}
      role="group"
      aria-label="Dinner plan printing press"
    >
      <div className="pp-workbench-label">
        <span>THE COMMON TABLE PRESS</span>
        <span>NO. 001 · EST. A GOOD EVENING</span>
      </div>
      <p className="pp-operating-instruction" id="press-operating-instruction">
        Pull the brass lever to press this plan.
      </p>
      <div className="pp-machine">
        <div className="pp-stock" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="pp-cast-housing">
          <span className="pp-screw pp-screw-a" aria-hidden="true" />
          <span className="pp-screw pp-screw-b" aria-hidden="true" />
          <span className="pp-screw pp-screw-c" aria-hidden="true" />
          <span className="pp-screw pp-screw-d" aria-hidden="true" />
          <div className="pp-makerplate" aria-hidden="true">
            COMMON TABLE<span>LETTERPRESS & EVENINGS</span>
          </div>
          <div className="pp-gauge" aria-hidden="true">
            <span />
            <i />
            <b>PRESSURE</b>
          </div>
          <div className="pp-inspection-window" aria-hidden="true">
            <span className="pp-belt" />
            <Gear className="pp-gear-left" />
            <Gear className="pp-gear-right" />
            <Gear className="pp-gear-small" />
            <span className="pp-ink-rail" />
            <span className="pp-platen">
              <i>AN EVENING AGREED</i>
            </span>
          </div>
          <div className="pp-front-roller" aria-hidden="true">
            <i />
            <i />
          </div>
          <button
            className="pp-lever"
            aria-label="Operate dinner plan press"
            aria-describedby="press-operating-instruction"
            title={
              saved
                ? "Reprint your current dinner plan"
                : ready
                  ? "Save and press your dinner plan"
                  : "Complete the details and approvals to operate the press"
            }
            onClick={() => {
              if (!printing) (saved ? onReprint : onOperate)();
            }}
            disabled={!ready && !saved}
            aria-disabled={printing}
          >
            <span className="pp-lever-arm" />
            <span className="pp-lever-grip" />
            <span className="pp-lever-hub" />
          </button>
          <div className="pp-foot pp-foot-left" aria-hidden="true" />
          <div className="pp-foot pp-foot-right" aria-hidden="true" />
        </div>
        <div className="pp-output-mouth" aria-hidden="true">
          <i />
        </div>
      </div>
      <div className="pp-receipt-feed">
        <div
          className="pp-live-sheet"
          style={{ "--pp-pull-y": `${pullPixels}px` } as CSSProperties}
        >
          {saved && (
            <div className="pp-tear-perforation">
              <div className="pp-tear-rule" aria-hidden="true" />
              <button
                ref={tearHandle}
                className="pp-tear-handle"
                aria-label={
                  detached ? "Dinner plan detached" : "Tear off dinner plan"
                }
                aria-describedby="press-tear-instruction"
                aria-disabled={printing || detached}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && cancelActivePull()) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onPointerDown={beginPull}
                onPointerMove={movePull}
                onPointerUp={(event) => finishPull(event)}
                onPointerCancel={(event) => finishPull(event, true)}
                onLostPointerCapture={(event) => {
                  if (pull.current?.pointerId === event.pointerId)
                    finishPull(event, true);
                }}
                onClick={(event) => {
                  if (event.detail !== 0 && suppressPointerClick.current) {
                    suppressPointerClick.current = false;
                    return;
                  }
                  suppressPointerClick.current = false;
                  detachReceipt();
                }}
              >
                {detached ? "Dinner plan detached" : "Tear off dinner plan"}
              </button>
              <span id="press-tear-instruction" className="pp-tear-instruction">
                {detached
                  ? "On the table. Reprint for a fresh attached copy."
                  : "Pull down, click, or press Enter. Short pulls spring back."}
              </span>
            </div>
          )}
          {children}
          {saved && (
            <div className="pp-agreement-stamp" aria-hidden="true">
              <span>COMMON GROUND</span>
              <Check size={19} />
              <strong>
                AN EVENING
                <br />
                AGREED
              </strong>
              <small>PLAN · NOT A BOOKING</small>
            </div>
          )}
        </div>
      </div>
      <div className="pp-press-console">
        {tearMessage && (
          <p className="pp-tear-message" role="status">
            {tearMessage}
          </p>
        )}
        <p className="pp-status" role="status">
          <span className={`pp-status-light ${saved ? "is-ready" : ""}`} />
          {printing
            ? "Inking. Pressing. An evening on paper."
            : saved
              ? storageAvailable
                ? "Your current plan, pressed & saved locally."
                : "Pressed for this session. Download a copy to keep it."
              : ready
                ? "All seats agree. The press is ready."
                : "A proof of your evening. Set the details & gather the nods."}
        </p>
        {saved && (
          <button
            className="pp-reprint"
            onClick={() => {
              if (!printing) onReprint();
            }}
            aria-disabled={printing}
          >
            <RotateCcw size={13} />
            Reprint dinner plan
          </button>
        )}
      </div>
      <p className="pp-printing-note">
        A little ink, a little anticipation.
        <span>
          Visual press only · no printer, booking, or download starts
          automatically.
        </span>
      </p>
    </div>
  );
}
export default PrintingPress;
