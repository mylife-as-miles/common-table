import type {MapPoint} from '../components/GeographicMap';
export interface StoredArea {latitude:number;longitude:number;label:string;source:'search'|'saved'}
export interface LocationSnapshot {schema:1;area:StoredArea|null;savedPoints:MapPoint[]}
export type LocationChange={kind:'area';area:StoredArea}|{kind:'point';point:MapPoint;saved:boolean};
export const emptyLocation=():LocationSnapshot=>({schema:1,area:null,savedPoints:[]});
export const validCoordinate=(lat:unknown,lon:unknown)=>typeof lat==='number'&&Number.isFinite(lat)&&Math.abs(lat)<=85&&typeof lon==='number'&&Number.isFinite(lon)&&Math.abs(lon)<=180;
export function validMapPoint(value:unknown):value is MapPoint {if(!value || typeof value!=='object')return false;const p=value as MapPoint;return typeof p.id==='string'&&p.id.length>0&&p.id.length<250&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=300&&['food','coffee','outdoors','other'].includes(p.category)&&validCoordinate(p.latitude,p.longitude);}
export function cleanLocationSnapshot(value:unknown):LocationSnapshot {
  if(!value || typeof value!=='object')return emptyLocation();
  const v=value as LocationSnapshot;
  if(v.schema!==1 || !Array.isArray(v.savedPoints))return emptyLocation();
  const area=v.area && ['search','saved'].includes(v.area.source) && typeof v.area.label==='string' && validCoordinate(v.area.latitude,v.area.longitude) ? {latitude:v.area.latitude,longitude:v.area.longitude,label:v.area.label.slice(0,300),source:v.area.source}:null;
  const points=v.savedPoints.filter(validMapPoint).slice(-200).map(p=>({id:p.id,name:p.name,category:p.category,latitude:p.latitude,longitude:p.longitude}));
  return {schema:1,area,savedPoints:[...new Map(points.map(p=>[p.id,p])).values()]};
}
/** Device GPS is deliberately not a persistable area source. Only explicit bookmarked POIs survive. */
export function applyLocationChange(base:LocationSnapshot,change:LocationChange):LocationSnapshot {
  if(change.kind==='area')return cleanLocationSnapshot({...base,area:change.area});
  const points=base.savedPoints.filter(p=>p.id!==change.point.id);
  return cleanLocationSnapshot({...base,savedPoints:change.saved?[...points,change.point]:points});
}
