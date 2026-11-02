import test from "node:test";
import assert from "node:assert/strict";
import { getBookingHandoff, sanitizeBookingUrl, bookingPlanSummary } from "../src/booking/capability.ts";
import type { Venue } from "../src/domain/types.ts";

const venue = (changes: Partial<Venue> = {}): Venue => ({ id:"real:1",source:"osm",name:"Example restaurant",cuisine:"Restaurant",neighborhood:"Brooklyn",price:0,rating:0,walkMinutes:0,description:"",story:"",tags:[],dietary:[],image:"/venue-placeholder.svg",accent:"#a96846",coordinates:{x:50,y:50},menu:[],...changes });
test("booking prefers the supplied public reservation URL without inventing request parameters",()=>{
  const result=getBookingHandoff(venue({bookingUrl:"https://reservations.example.com/restaurant?id=17",websiteUrl:"https://restaurant.example.com/"}));
  assert.deepEqual(result,{status:"available",kind:"reservation",href:"https://reservations.example.com/restaurant?id=17",hostname:"reservations.example.com",label:"Check reservations"});
});
test("invalid booking links fall back to a valid restaurant website",()=>{
  const result=getBookingHandoff(venue({bookingUrl:"javascript:alert(1)",websiteUrl:"https://restaurant.example.com/menu"}));
  assert.equal(result.status,"available");if(result.status!=="available")return;
  assert.equal(result.label,"Visit restaurant");assert.equal(result.href,"https://restaurant.example.com/menu");
});
test("sample or missing venues never gain real reservation capabilities",()=>{
  for(const item of [null,venue({source:"demo",bookingUrl:"https://restaurant.example.com/"}),venue({source:undefined,websiteUrl:"https://restaurant.example.com/"})]) {
    assert.notEqual(getBookingHandoff(item).status,"available");
  }
  assert.equal(getBookingHandoff(venue()).status,"unavailable");
});
test("booking URL sanitization rejects credentials, non-HTTPS, IPs and local/private host forms",()=>{
  for(const url of ["http://restaurant.example.com/","javascript:alert(1)","data:text/html,hello","//restaurant.example.com/","https://user:secret@restaurant.example.com/","https://127.0.0.1/","https://2130706433/","https://0x7f000001/","https://192.168.1.4/","https://10.0.0.1/","https://169.254.169.254/","https://[::1]/","https://[::ffff:127.0.0.1]/","https://localhost/","https://restaurant.localhost/","https://restaurant.local/","https://restaurant.internal/","https://restaurant.lan/","https://restaurant.home.arpa/","https://intranet/","https://restaurant.example.com:8443/","https://restaurant.example.com/\nmalformed",`https://restaurant.example.com/${"x".repeat(2100)}`]) assert.equal(sanitizeBookingUrl(url),undefined,url);
  assert.equal(sanitizeBookingUrl("https://restaurant.example.com/a?time=19%3A00#book"),"https://restaurant.example.com/a?time=19%3A00#book");
});
test("booking plan details validate calendar/time/group size and do not imply a confirmed booking",()=>{
  const summary=bookingPlanSummary("2026-11-02","19:30",4);
  assert.equal(summary.dateLabel,"Mon, Nov 2");assert.equal(summary.timeLabel,"19:30");assert.equal(summary.partyLabel,"4 people");assert.equal(summary.valid,true);
  assert.equal(bookingPlanSummary("2026-02-30","25:00",0).valid,false);
  assert.equal(bookingPlanSummary("2026-11-02","19:30",1).partyLabel,"1 person");
});
