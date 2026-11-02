import test from "node:test";
import assert from "node:assert/strict";
import {createWeatherHandler} from "../server/weather.ts";
import {parseMetForecast} from "../server/weather-met.ts";

const now=Date.parse("2026-11-02T17:00:00Z");
const query=(hour=19,date="2026-11-02")=>new Request(`https://common-table.example/api/weather?latitude=40.692&longitude=-73.977&date=${date}&hour=${hour}`);
function met() {
  const entry=(time:string,symbol:string,amount?:number)=>({time,data:{instant:{details:{air_temperature:10,wind_speed:3}},next_1_hours:{summary:{symbol_code:symbol},details:amount===undefined?{}:{precipitation_amount:amount}}}});
  return {type:"Feature",geometry:{type:"Point",coordinates:[-73.98,40.69,12]},properties:{meta:{updated_at:"2026-11-02T16:00:00Z",units:{air_temperature:"celsius",wind_speed:"m/s",precipitation_amount:"mm"}},timeseries:[entry("2026-11-02T17:00:00Z","cloudy"),entry("2026-11-03T00:00:00Z","clearsky_night",0),entry("2026-11-03T02:00:00Z","lightrain",.3),entry("2026-11-09T00:00:00Z","cloudy")]}};
}
test("429 fallback uses only fixed MET host, identifying UA, coarse coordinates and real local hour",async()=>{
  const calls:{url:URL;signal:AbortSignal|null|undefined}[]=[];
  const handle=createWeatherHandler({now:()=>now,intervalMs:0,onDiagnostic:()=>{},fetch:async(input,init)=>{
    const url=new URL(String(input));calls.push({url,signal:init?.signal});
    if(url.hostname==="api.open-meteo.com")return new Response("quota",{status:429});
    assert.equal(url.origin,"https://api.met.no");assert.equal(url.pathname,"/weatherapi/locationforecast/2.0/compact");
    assert.equal(url.searchParams.get("lat"),"40.69");assert.equal(url.searchParams.get("lon"),"-73.98");assert.equal(init?.redirect,"manual");
    assert.match(new Headers(init?.headers).get("user-agent")||"",/CommonTable.*https:\/\/github\.com\/mylife-as-miles\/common-table/);
    return Response.json(met());
  }});
  const response=await handle(query());const result=await response.json();
  assert.equal(response.status,200);assert.equal(calls.length,2);assert.equal(calls[0].signal,calls[1].signal);
  assert.equal(result.timezone,"America/New_York");assert.equal(result.utcOffsetSeconds,-18000);
  assert.equal(result.current.time,"2026-11-02T12:00");assert.equal(result.current.isDay,null);
  assert.equal(result.dinner.time,"2026-11-02T19:00");assert.equal(result.dinner.isDay,false);
  assert.equal(result.dinner.feelsLikeC,null);assert.equal(result.dinner.precipitationProbability,null);
  assert.equal(result.dinner.windKmh,10.8);assert.equal(result.dinner.precipitationMm,0);
  const missing=await(await handle(query(20))).json();assert.equal(missing.dinnerStatus,"unavailable");assert.equal(missing.dinner,null);
  const beyond=await(await handle(query(19,"2026-11-16"))).json();assert.equal(beyond.dinnerStatus,"outside_forecast");assert.equal(beyond.dinner,null);
});
test("unknown symbols, missing values and stale model dates never become fabricated weather",()=>{
  const data=met();data.properties.timeseries[1].data.next_1_hours.summary.symbol_code="something_new_night";
  const result=parseMetForecast(data,40.69,-73.98,now);
  assert.equal(result.hours.has("2026-11-02T19:00"),false);assert.equal(result.current.feelsLikeC,null);assert.equal(result.current.precipitationMm,null);
  data.properties.timeseries[1].data.next_1_hours.summary.symbol_code="clearsky_polartwilight";
  assert.equal(parseMetForecast(data,40.69,-73.98,now).hours.get("2026-11-02T19:00")?.isDay,null);
  data.properties.meta.updated_at="2026-10-31T00:00:00Z";assert.throws(()=>parseMetForecast(data,40.69,-73.98,now),/unavailable/);
});
test("offline IANA conversion retains half-hour local timestamps without inventing an exact hour",()=>{
  const data=met();data.geometry.coordinates=[77.21,28.61,12];
  const result=parseMetForecast(data,28.61,77.21,now);
  assert.equal(result.timezone,"Asia/Kolkata");assert.equal(result.current.time,"2026-11-02T22:30");assert.equal(result.hours.has("2026-11-02T23:00"),false);
});
test("MET Expires is respected even after app freshness ends; stale data still expire after two hours",async()=>{
  let clock=now,metCalls=0;
  const handle=createWeatherHandler({now:()=>clock,intervalMs:0,onDiagnostic:()=>{},fetch:async input=>{
    if(new URL(String(input)).hostname==="api.open-meteo.com")return new Response(null,{status:429});
    metCalls++;return Response.json(met(),{headers:{Expires:new Date(now+3*60*60_000).toUTCString()}});
  }});
  assert.equal((await handle(query())).status,200);clock+=21*60_000;
  const stale=await(await handle(query())).json();assert.equal(stale.stale,true);assert.equal(metCalls,1);
  clock=now+121*60_000;assert.equal((await handle(query())).status,503);assert.equal(metCalls,1);
});
test("bad primary data and authentication errors do not trigger an alternate source",async()=>{
  for(const status of [200,400,401,403]){
    let calls=0;const handle=createWeatherHandler({now:()=>now,intervalMs:0,onDiagnostic:()=>{},fetch:async()=>{calls++;return Response.json({}, {status})}});
    assert.equal((await handle(query())).status,503);assert.equal(calls,1);
  }
});
test("fallback shares the original deadline and cannot turn another failed provider into sample weather",async()=>{
  let calls=0;const handle=createWeatherHandler({now:()=>now,timeoutMs:8,intervalMs:0,onDiagnostic:()=>{},fetch:async()=>{calls++;if(calls===1)return new Response(null,{status:429});return new Promise<Response>(()=>{});}});
  assert.equal((await handle(query())).status,504);assert.equal(calls,2);
  const failed=createWeatherHandler({now:()=>now,intervalMs:0,onDiagnostic:()=>{},fetch:async()=>new Response(null,{status:503})});
  const response=await failed(query());assert.equal(response.status,503);assert.equal((await response.json()).status,"error");
});
