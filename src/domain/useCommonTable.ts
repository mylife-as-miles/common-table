import { useEffect, useMemo, useReducer, useState } from "react";
import { venues } from "./data";
import { rankVenues } from "./ranking";
import { hydrateState, reducer, serializeState, STORAGE_KEY } from "./state";

function readStorage() {
  try {
    return hydrateState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return hydrateState(null);
  }
}

export function useCommonTable() {
  const [state, dispatch] = useReducer(reducer, undefined, readStorage);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const ranked = useMemo(() => rankVenues(state), [state]);
  const selectedVenue =
    venues.find((venue) => venue.id === state.selectedVenueId) ?? venues[0];
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeState(state));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, [state]);
  return { state, dispatch, ranked, selectedVenue, storageAvailable };
}
