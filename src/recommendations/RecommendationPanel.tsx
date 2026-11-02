import { ArrowRight, Compass, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { DiscoveryStatus } from './useRecommendations';
import './recommendations.css';
interface Props {status:DiscoveryStatus;message:string;needsRefresh?:boolean;hasResults?:boolean;locationLabel?:string;onRefresh:()=>void;onCancel:()=>void;onDemo?:()=>void;disabled?:boolean}
/** Discovery enters the same menu/map/table state; this is a search control, not a detached gallery. */
export function RecommendationPanel({status,message,needsRefresh,hasResults,locationLabel,onRefresh,onCancel,onDemo,disabled}:Props){
  const loading=status==='loading';
  return <section className="restaurant-discovery-note" aria-label="Find restaurants for this table" aria-busy={loading}>
    <span className="discovery-note-stamp" aria-hidden="true"><Compass size={22}/></span>
    <div className="discovery-note-copy"><span className="discovery-eyebrow">A FEW PLACES, CHOSEN TOGETHER</span><h2>{needsRefresh?'The table has changed.':hasResults?'Your next good evening.':'Let’s find your common ground.'}</h2><p>{locationLabel?`Near ${locationLabel}. `:''}Chosen for your table’s tastes, budget and needs.</p><p className="discovery-status" role="status" aria-live="polite">{message || 'Real restaurant discovery. Menus, exact prices and availability need confirmation.'}</p></div>
    <div className="discovery-actions"><button type="button" className="discovery-search" onClick={onRefresh} disabled={loading||disabled}>{loading?<LoaderCircle size={16} className="discovery-spin"/>:hasResults?<RotateCcw size={15}/>:<ArrowRight size={16}/>} {loading?'Finding places…':hasResults?'Refresh places':'Find real restaurants'}</button>{loading&&<button type="button" className="discovery-secondary" onClick={onCancel}><X size={14}/> Cancel search</button>}{onDemo&&<button type="button" className="discovery-secondary" onClick={onDemo}>Explore the sample evening</button>}</div>
  </section>;
}
