import test from "node:test";
import assert from "node:assert/strict";
import {parseWeatherReport, weatherCacheKey, weatherDescription, weatherQuery} from "../src/weather/client.ts";
import type {WeatherReport} from "../src/weather/types.ts";
const timestamp=Date.parse("2026-11-02T17:00:00Z");
const query={latitude:40.69,longitude:-73.98,date:"2026-11-02",hour:19};
const condition={time:"2026-11-02T12:00",temperatureC:11,feelsLikeC:9,weatherCode:2,isDay:true,windKmh:10,precipitationMm:0,precipitationProbability:null};
const report=():WeatherReport=>({status:"ok",area:{latitude:40.69,longitude:-73.98},requested:{date:query.date,hour:19},timezone:"America/New_York",utcOffsetSeconds:-18000,fetchedAt:new Date(timestamp).toISOString(),freshUntil:new Date(timestamp+20*60_000).toISOString(),staleUntil:new Date(timestamp+2*60*60_000).toISOString(),stale:false,current:condition,dinner:{...condition,time:"2026-11-02T19:00",precipitationProbability:30},dinnerStatus:"forecast"});
test("weather client coarsens location before network/storage and rejects invalid fields",()=>{
  assert.deepEqual(weatherQuery(40.692342,-73.977823,"2026-11-02","19:30"),query);
  assert.equal(weatherCacheKey(query),"weather:v1:40.69:-73.98:2026-11-02:19");
  for(const [lat,lon,date,time] of [[NaN,0,"2026-11-02","19:00"],[91,0,"2026-11-02","19:00"],[0,181,"2026-11-02","19:00"],[0,0,"2026-02-30","19:00"],[0,0,"2026-11-02","24:00"]] as const) assert.equal(weatherQuery(lat,lon,date,time),null);
});
test("weather client accepts only bounded matching data from network or cache",()=>{
  assert.equal(parseWeatherReport(report(),query,timestamp)?.dinner?.temperatureC,11);
  for(const invalid of [{...report(),area:{latitude:48.86,longitude:2.35}},{...report(),requested:{date:"2026-11-03",hour:19}},{...report(),timezone:"madeup"},{...report(),staleUntil:new Date(timestamp+24*60*60_000).toISOString()},{...report(),current:{...condition,temperatureC:"11"}},{...report(),dinner:{...condition,time:"2026-11-02T18:00"}},{...report(),dinnerStatus:"outside_forecast"}]) assert.equal(parseWeatherReport(invalid,query,timestamp),null);
  assert.equal(parseWeatherReport(report(),query,timestamp+2*60*60_000),null);
});
test("cached forecast for a dinner hour that passed is no longer displayed as future forecast",()=>{
  const data=report();data.fetchedAt="2026-11-03T00:00:00Z";data.freshUntil="2026-11-03T00:20:00Z";data.staleUntil="2026-11-03T02:00:00Z";
  const parsed=parseWeatherReport(data,query,Date.parse("2026-11-03T01:00:00Z"));
  assert.equal(parsed?.dinnerStatus,"past");assert.equal(parsed?.dinner,null);
});
test("weather labels represent supported conditions without manufacturing unknown weather",()=>{
  assert.equal(weatherDescription(0,false),"Clear night");assert.equal(weatherDescription(73,true),"Snow");assert.equal(weatherDescription(95,false),"Thunderstorms");assert.equal(weatherDescription(999,true),"Conditions unavailable");
});
test("unknown alternate-source feels-like, precipitation and daylight remain nullable",()=>{
  const data=report();data.current={...data.current,feelsLikeC:null,precipitationMm:null,precipitationProbability:null,isDay:null};data.dinner={...data.dinner!,feelsLikeC:null,precipitationMm:null,precipitationProbability:null,isDay:null};
  assert.equal(parseWeatherReport(data,query,timestamp)?.dinner?.feelsLikeC,null);
  assert.equal(weatherDescription(0,null),"Clear sky");
});
