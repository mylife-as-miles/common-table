import { useState, type Dispatch } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Download,
  MapPin,
  Pencil,
  Utensils,
} from "lucide-react";
import {
  type Action,
  type AppState,
  venues,
  rankVenues,
  planValidationErrors,
} from "../domain";
import "./table-plan.css";
import { PrintingPress } from "./PrintingPress";
import "./dinner-cinematic.css";

interface DinnerPlanProps {
  lowPower?: boolean;
  storageAvailable?: boolean;
  state: AppState;
  dispatch: Dispatch<Action>;
  onExplore: () => void;
  onTable: () => void;
}
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function DinnerPlan({
  state,
  dispatch,
  onExplore,
  onTable,
  storageAvailable = true,
  lowPower = false,
}: DinnerPlanProps) {
  const [message, setMessage] = useState("");
  const [printRequest, setPrintRequest] = useState(0);
  const printJobKey = JSON.stringify({
    venueId: state.plan.venueId,
    date: state.plan.date,
    time: state.plan.time,
    note: state.plan.note,
    approvals: state.plan.approvals,
    participants: state.participants,
  });
  const venue = venues.find((v) => v.id === state.plan.venueId);
  const eligible =
    venue && rankVenues(state).some((r) => r.venue.id === venue.id);
  const dateObject = new Date(`${state.plan.date}T12:00:00`);
  const canonicalDate = !Number.isNaN(dateObject.getTime())
    ? `${dateObject.getFullYear()}-${String(dateObject.getMonth() + 1).padStart(2, "0")}-${String(dateObject.getDate()).padStart(2, "0")}`
    : "";
  const dateValid =
    state.plan.date >= localDate() &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.plan.date) &&
    canonicalDate === state.plan.date;
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(state.plan.time);
  const validationErrors = planValidationErrors(state);
  const canSave = Boolean(
    venue && eligible && dateValid && timeValid && !validationErrors.length,
  );
  const longDate = dateValid
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(dateObject)
    : "Choose a date";
  const people = state.participants.map((p) => p.name).join(", ");
  const planText = venue
    ? `COMMON TABLE — Dinner plan\n\n${venue.name}\n${venue.cuisine} · ${venue.neighborhood}, Brooklyn\n${longDate} at ${state.plan.time}\nTable for ${state.participants.length}: ${people}\nEstimated $${venue.price} per person (demo estimate)\n${state.plan.note ? `\nNote: ${state.plan.note}\n` : ""}\nA suggested plan, not a booking. Fictional demo venue. Confirm location, hours, ingredients and availability before going.\nMade with Common Table`
    : "";
  function savePlan() {
    if (!canSave || state.plan.saved) return;
    dispatch({ type: "save-plan" });
    setPrintRequest((value) => value + 1);
    setMessage(
      storageAvailable
        ? "Your dinner plan is saved on this device. No reservation was made."
        : "Browser storage is unavailable. Your plan is only kept for this session; download it to keep a copy.",
    );
  }
  function reprintPlan() {
    if (!state.plan.saved || !canSave) return;
    setPrintRequest((value) => value + 1);
    setMessage(
      "A fresh visual impression of your current dinner plan. No printer or download was started.",
    );
  }
  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(planText);
      setMessage(
        "Dinner plan copied. Paste it wherever you’d like to share it.",
      );
    } catch {
      setMessage(
        "Clipboard isn’t available here. Download the plan as a text file instead.",
      );
    }
  }
  function downloadPlan() {
    const blob = new Blob([planText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "common-table-dinner-plan.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Dinner plan downloaded as a text file.");
  }
  return (
    <section className="tp-scene tp-plan-scene" aria-labelledby="plan-heading">
      <div className="tp-section-head">
        <div>
          <span className="tp-eyebrow">03 / SOMETHING TO LOOK FORWARD TO</span>
          <h2 id="plan-heading">
            An evening,
            <br />
            <em>in good company.</em>
          </h2>
        </div>
        <p>
          A place. A time.
          <br />
          The rest is conversation.
        </p>
      </div>
      {!venue ? (
        <div className="tp-empty tp-plan-empty">
          <Utensils size={32} />
          <h3>Your evening is still unwritten.</h3>
          <p>Find a place in the menu, then bring it to your table.</p>
          <button className="tp-dark-button" onClick={onExplore}>
            Find your restaurant <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="tp-plan-layout">
          <PrintingPress
            saved={state.plan.saved}
            ready={canSave}
            jobKey={printJobKey}
            request={printRequest}
            lowPower={lowPower}
            storageAvailable={storageAvailable}
            onOperate={savePlan}
            onReprint={reprintPlan}
          >
            <article className="tp-receipt" aria-label="Dinner plan summary">
              <div className="tp-receipt-top">
                <span className="tp-receipt-brand">
                  common table<span>GOOD FOOD. BETTER COMPANY.</span>
                </span>
                <Utensils size={21} />
              </div>
              <div className="tp-receipt-status">
                {state.plan.saved ? (
                  <>
                    <CheckCircle2 size={14} />{" "}
                    {storageAvailable
                      ? "SAVED ON THIS DEVICE"
                      : "KEPT FOR THIS SESSION"}
                  </>
                ) : (
                  <>
                    <Pencil size={13} /> YOUR EVENING, IN THE MAKING
                  </>
                )}
              </div>
              <span className="tp-receipt-caption">WE’LL MEET AT</span>
              <h3>{venue.name}</h3>
              <p className="tp-receipt-cuisine">
                {venue.cuisine} · {venue.neighborhood}
              </p>
              <img
                className="tp-plan-photo"
                src={venue.image}
                alt={`Atmosphere inspiration for ${venue.name}`}
              />
              <div className="tp-receipt-line">
                <CalendarDays size={17} />
                <div>
                  <strong>{longDate}</strong>
                  <span>
                    {state.plan.time || "Choose a time"} · your chosen local
                    time
                  </span>
                </div>
              </div>
              <div className="tp-receipt-line">
                <Utensils size={17} />
                <div>
                  <strong>Table for {state.participants.length}</strong>
                  <span>{people}</span>
                </div>
              </div>
              <div className="tp-receipt-line">
                <MapPin size={17} />
                <div>
                  <strong>{venue.neighborhood}, Brooklyn</strong>
                  <span>Fictional venue · demonstration only</span>
                </div>
              </div>
              <div className="tp-receipt-total">
                <span>Estimated per person</span>
                <strong>
                  ${venue.price}
                  <small> + tip & tax</small>
                </strong>
              </div>
              {state.plan.note && (
                <p className="tp-receipt-note">“{state.plan.note}”</p>
              )}
              <p className="tp-receipt-footer">
                Leave a little room for the unexpected.
                <span>THIS IS A PLAN, NOT A RESERVATION.</span>
              </p>
            </article>
          </PrintingPress>
          <div className="tp-plan-editor">
            <div className="tp-plan-current">
              <img src={venue.image} alt="" />
              <div>
                <span className="tp-eyebrow">YOUR CHOSEN PLACE</span>
                <strong>{venue.name}</strong>
                <small>
                  {venue.neighborhood} · ${venue.price} / person
                </small>
              </div>
            </div>
            <span className="tp-eyebrow">THE LITTLE DETAILS</span>
            <h3>Make an evening of it.</h3>
            <p className="tp-subtext">
              Set a time that works. You can always change your mind.
            </p>
            <div className="tp-date-fields">
              <label htmlFor="plan-date">
                Day
                <input
                  id="plan-date"
                  type="date"
                  min={localDate()}
                  value={state.plan.date}
                  onChange={(e) => {
                    dispatch({
                      type: "update-plan",
                      changes: { date: e.target.value },
                    });
                    setMessage("");
                  }}
                  required
                />
              </label>
              <label htmlFor="plan-time">
                Time
                <input
                  id="plan-time"
                  type="time"
                  value={state.plan.time}
                  onChange={(e) => {
                    dispatch({
                      type: "update-plan",
                      changes: { time: e.target.value },
                    });
                    setMessage("");
                  }}
                  required
                />
              </label>
            </div>
            <label className="tp-note-label" htmlFor="plan-note">
              A note for the evening <span>optional</span>
              <textarea
                id="plan-note"
                rows={3}
                maxLength={350}
                value={state.plan.note}
                onChange={(e) => {
                  dispatch({
                    type: "update-plan",
                    changes: { note: e.target.value },
                  });
                  setMessage("");
                }}
                placeholder="A long dinner, no rushing. Maybe a walk after."
              />
            </label>
            <div className="tp-plan-people">
              <div>
                <span className="tp-eyebrow">THE COMPANY</span>
                <strong>
                  {state.participants.length === 1
                    ? "A table just for you"
                    : `${state.participants.length} people, one table`}
                </strong>
              </div>
              <button className="tp-text-button" onClick={onTable}>
                Edit table <ArrowRight size={14} />
              </button>
            </div>
            {!eligible && (
              <p className="tp-fit-warning" role="alert">
                This restaurant no longer fits your table’s needs or has been
                vetoed. Choose another place, or revise the table before saving.
              </p>
            )}
            {validationErrors
              .filter(
                (error) =>
                  !error.startsWith("This restaurant") &&
                  !error.startsWith("Choose a restaurant") &&
                  !/approv|agree/i.test(error),
              )
              .map((error) => (
                <p key={error} className="tp-fit-warning" role="status">
                  {error}
                </p>
              ))}
            <fieldset className="tp-approvals">
              <legend>
                {state.participants.length === 1
                  ? "YOUR LITTLE NOD"
                  : "A NOD AROUND THE TABLE"}{" "}
                <span>
                  {state.plan.approvals.length}/{state.participants.length}
                </span>
              </legend>
              <p>
                {state.participants.length === 1
                  ? "Happy with the place, time, and budget?"
                  : "Try the agreement flow. Check each seat to simulate a yes."}
              </p>
              <div>
                {state.participants.map((person) => (
                  <label key={person.id}>
                    <input
                      type="checkbox"
                      checked={state.plan.approvals.includes(person.id)}
                      disabled={!eligible}
                      onChange={() => {
                        dispatch({
                          type: "toggle-approval",
                          participantId: person.id,
                        });
                        setMessage("");
                      }}
                    />
                    <span>
                      {person.id === "you"
                        ? "Works for me"
                        : `${person.name} agrees`}
                      {person.id !== "you" && <small>LOCAL DEMO</small>}
                    </span>
                  </label>
                ))}
              </div>
              <small>
                Local demo approvals · no responses are sent. Editing the
                details resets these decisions.
              </small>
            </fieldset>
            <button
              className="tp-dark-button tp-save-plan"
              disabled={!canSave}
              aria-disabled={state.plan.saved}
              onClick={savePlan}
            >
              {state.plan.saved ? (
                <>
                  <Check size={16} />{" "}
                  {storageAvailable
                    ? "Saved for a good evening"
                    : "Kept for this session"}
                </>
              ) : (
                <>
                  Save this dinner plan <ArrowRight size={16} />
                </>
              )}
            </button>
            <p className="tp-fine">
              {storageAvailable
                ? "Stored in this browser."
                : "Browser storage is unavailable. This plan lasts only for this session; download a copy to keep it."}{" "}
              Editing the venue, guests, or details resets agreement and updates
              your draft; save again to keep the revised plan.
            </p>
            <div className="tp-share-actions">
              <button
                className="tp-outline"
                disabled={!canSave}
                onClick={copyPlan}
              >
                <Copy size={15} /> Copy plan
              </button>
              <button
                className="tp-outline"
                disabled={!canSave}
                onClick={downloadPlan}
              >
                <Download size={15} /> Download
              </button>
            </div>
            <div className="tp-honest-note">
              <strong>A little housekeeping.</strong>
              <p>
                All venues and prices are demo data. No booking, invitation, or
                location sharing takes place. Always confirm dietary needs and
                allergy safety with the restaurant.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="tp-bottom-actions">
        <button className="tp-text-button" onClick={onExplore}>
          <ArrowLeft size={15} /> Back to the menu
        </button>
        <button className="tp-text-button" onClick={onTable}>
          Your shared table <ArrowRight size={15} />
        </button>
      </div>
      <p className="tp-live" role="status">
        {message}
      </p>
    </section>
  );
}

export default DinnerPlan;
