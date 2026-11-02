import { ArrowUpRight, CalendarDays, Clock3, ExternalLink, Utensils, Users } from "lucide-react";
import type { Venue } from "../domain/types";
import { bookingPlanSummary, getBookingHandoff } from "./capability";
import "./booking.css";

export interface BookingCardProps { venue: Venue | null; date: string; time: string; partySize: number }

export function BookingCard({ venue, date, time, partySize }: BookingCardProps) {
  const handoff = getBookingHandoff(venue);
  const plan = bookingPlanSummary(date, time, partySize);
  return <section className="booking-paper" aria-label={venue ? `Restaurant reservations for ${venue.name}` : "Restaurant reservations"} data-booking-state={handoff.status}>
    <header className="booking-heading"><div><span className="booking-kicker">THE LAST LITTLE DETAIL</span><h2>A place at the table.</h2></div><Utensils size={24} strokeWidth={1.1} aria-hidden="true" /></header>
    {venue && <h3 className="booking-restaurant">{venue.name}</h3>}
    <dl className="booking-plan-details"><div><dt><CalendarDays size={13} />Date</dt><dd>{plan.dateLabel}</dd></div><div><dt><Clock3 size={13} />Time</dt><dd>{plan.timeLabel}</dd></div><div><dt><Users size={13} />Table for</dt><dd>{plan.partyLabel}</dd></div></dl>
    {handoff.status === "available" ? <>
      <p className="booking-explanation">Continue with the restaurant to check availability and make your reservation.</p>
      <a className="booking-handoff" href={handoff.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><span>{handoff.label}</span><ArrowUpRight size={17} aria-hidden="true" /><span className="booking-sr-only"> (opens a new tab)</span></a>
      <p className="booking-destination"><ExternalLink size={11} aria-hidden="true" />Opens {handoff.hostname}</p>
      <p className="booking-footnote">Your dinner details are shown here for reference. Complete and confirm the reservation with the restaurant.</p>
    </> : <div className="booking-unavailable"><p>{handoff.status === "demo" ? "Sample plan · no real reservation" : handoff.status === "no_venue" ? "Choose a restaurant to take the next step." : "A reservation link is not listed for this restaurant."}</p><span>{handoff.status === "demo" ? "This restaurant is fictional. Your sample dinner plan can still be saved and shared." : handoff.status === "no_venue" ? "Your dinner date, time and group size will stay connected to the plan." : "Contact the restaurant directly to check availability. This plan does not reserve a table."}</span></div>}
    {!plan.valid && <p className="booking-input-note">Choose a valid date, time and group size in your dinner plan before continuing.</p>}
  </section>;
}

export default BookingCard;
