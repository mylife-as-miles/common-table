"use client";
import { useEffect, useState, type ComponentType } from "react";
export default function Home() {
  const [App, setApp] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    import("../src/App").then(m => { if (active) setApp(() => m.default); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return <div id="root">{App ? <App /> : <main style={{padding:"3rem",maxWidth:"46rem",margin:"auto",color:"#f5efd9",minHeight:"100svh"}}><h1>Common Table</h1><p role="status">{failed ? "The dining room could not load. Please refresh to try again." : "Opening your table…"}</p><noscript>Enable JavaScript to use this interactive dining planner.</noscript></main>}</div>;
}
