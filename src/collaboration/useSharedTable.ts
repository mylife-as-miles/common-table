import { useCallback, useEffect, useRef, useState } from "react";
import { get, put, deleteValue } from "../storage";
import { loadDraft, saveDraft, removeDraft, type OfflineDraft } from "../storage/drafts";
import { sanitizeVenueSnapshot } from "../domain/catalog";
import { defaultSharedPreferences, sharedPreferencesOnly, sharedMutationTarget, type SharedIdentity, type SharedInvitationPreview, type SharedPlan, type SharedPreferences, type SharedTableSnapshot, type SharedTableSummary } from "./types";

export interface SharedChangeDraft { action: "preferences" | "plan"; payload: SharedPreferences | SharedPlan; baseVersion: number; operationKey: string; conflict: boolean }
class RequestError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
export const inviteTokenFromHash = (hash: string) => /^#join\/([a-zA-Z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
export function createInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const validSnapshot = (value: unknown): value is SharedTableSnapshot => {
  if (!value || typeof value !== "object") return false;
  const t = value as SharedTableSnapshot;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  const labels = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every(x => text(x, 40));
  return text(t.id, 80) && text(t.title, 100) && text(t.ownerId, 200) && text(t.viewerId, 200) && Number.isSafeInteger(t.version) && t.version >= 1 && Number.isSafeInteger(t.revision) && t.revision >= 1 && t.version >= t.revision && Number.isFinite(t.updatedAt) && Array.isArray(t.members) && t.members.length >= 1 && t.members.length <= 6 && new Set(t.members.map(m => m.userId)).size === t.members.length && t.members.some(m => m.userId === t.viewerId) && t.members.some(m => m.userId === t.ownerId && m.role === "owner") && t.members.every(m => text(m.userId, 200) && text(m.displayName, 160) && ["owner", "member"].includes(m.role) && (m.approvedRevision === null || Number.isSafeInteger(m.approvedRevision) && m.approvedRevision >= 1) && m.preferences && labels(m.preferences.tastes, 16) && labels(m.preferences.restrictions, 12) && Number.isFinite(m.preferences.budget) && m.preferences.budget >= 1 && m.preferences.budget <= 1000) && Boolean(t.plan && text(t.plan.date, 10) && text(t.plan.time, 5) && text(t.plan.note, 1000) && typeof t.plan.saved === "boolean" && (t.plan.detailsAcknowledged === undefined || typeof t.plan.detailsAcknowledged === "boolean") && (t.plan.venueId === null ? t.plan.venueSnapshot === null : typeof t.plan.venueId === "string" && sanitizeVenueSnapshot(t.plan.venueSnapshot)?.id === t.plan.venueId));
};
const cacheKey = (userId: string, tableId: string) => `shared-table:v1:${userId}:${tableId}`;
const selectedKey = (userId: string) => `shared-table-selection:v1:${userId}`;

export function useSharedTable() {
  const [identity, setIdentity] = useState<SharedIdentity | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [table, setTable] = useState<SharedTableSnapshot | null>(null);
  const [tables, setTables] = useState<SharedTableSummary[]>([]);
  const [status, setStatus] = useState<"local" | "connected" | "offline">("local");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<OfflineDraft<SharedChangeDraft> | undefined>();
  const [inviteLink, setInviteLink] = useState("");
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => typeof window === "undefined" ? null : inviteTokenFromHash(window.location.hash));
  const [invitation, setInvitation] = useState<SharedInvitationPreview | null>(null);
  const tableRef = useRef(table), identityRef = useRef(identity), requestRef = useRef<AbortController | null>(null), etag = useRef("");
  const mutationBusy = useRef(false), mounted = useRef(true), selectedRef = useRef<string | null>(null), selectionGeneration = useRef(0), mutationRequest = useRef<AbortController | null>(null);
  tableRef.current = table; identityRef.current = identity;

  const request = useCallback(async (path: string, body?: unknown, operationKey?: string, signal?: AbortSignal) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", "X-Common-Table-Request": "shared-table", ...(operationKey ? { "Idempotency-Key": operationKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let result: Record<string, unknown>; try { result = await response.json(); } catch { throw new RequestError("unavailable", 503); }
      if (!response.ok) throw new RequestError(typeof result.code === "string" ? result.code : "unavailable", response.status);
      return result;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }, []);
  const adopt = useCallback(async (next: SharedTableSnapshot) => {
    if (!validSnapshot(next) || next.viewerId !== identityRef.current?.userId) throw new RequestError("unavailable", 503);
    if (!mounted.current) return;
    tableRef.current = next; selectedRef.current = next.id; setTable(next); setStatus("connected"); etag.current = `"ct:${next.id}:${next.version}"`;
    setError(current => current.startsWith("The table could not be refreshed.") ? "" : current);
    void put("cache", cacheKey(next.viewerId, next.id), next).catch(() => undefined);
    void put("settings", selectedKey(next.viewerId), next.id).catch(() => undefined);
  }, []);
  const refresh = useCallback(async (id = selectedRef.current) => {
    if (!id || !identityRef.current) return;
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    try {
      const response = await fetch(`/api/shared-tables/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), headers: etag.current && id === tableRef.current?.id ? { "If-None-Match": etag.current } : {} });
      if (controller.signal.aborted || selectedRef.current !== id) return;
      if (response.status === 304) { setStatus("connected"); setError(current => current.startsWith("The table could not be refreshed.") ? "" : current); return; }
      if (!response.ok) throw new RequestError(response.status === 404 ? "not_found" : "unavailable", response.status);
      const body = await response.json(); await adopt(body.table);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof RequestError && [401, 404].includes(failure.status)) { tableRef.current = null; setTable(null); selectedRef.current = null; setStatus("local"); setError("This shared table is no longer available to your account."); }
      else { setStatus("offline"); setError("The table could not be refreshed. This is an offline copy; changes stay as drafts until you retry."); }
    }
  }, [adopt]);
  const select = useCallback(async (id: string) => {
    const who = identityRef.current; if (!who) return;
    const generation = ++selectionGeneration.current;
    requestRef.current?.abort(); mutationRequest.current?.abort();
    if (tableRef.current?.id !== id) { tableRef.current = null; setTable(null); setStatus("local"); }
    selectedRef.current = id; etag.current = ""; setError(""); setInviteLink(""); setDraft(undefined);
    const cached = await get<SharedTableSnapshot>("cache", cacheKey(who.userId, id)).catch(() => undefined);
    if (validSnapshot(cached) && cached.viewerId === who.userId && selectedRef.current === id) { tableRef.current = cached; setTable(cached); setStatus("offline"); }
    const savedDraft = await loadDraft<SharedChangeDraft>(id, who.userId).catch(() => undefined);
    if (generation !== selectionGeneration.current || !mounted.current) return;
    setDraft(savedDraft);
    await refresh(id);
  }, [refresh]);
  const refreshList = useCallback(async () => {
    const result = await request("/api/shared-tables");
    if (mounted.current && Array.isArray(result.tables)) setTables(result.tables as SharedTableSummary[]);
  }, [request]);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void (async () => {
      try {
        const result = await request("/api/shared-tables/session", undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        const who = result.identity as SharedIdentity | null;
        if (who && typeof who.userId === "string" && typeof who.displayName === "string") { identityRef.current = who; setIdentity(who); }
        setAvailable(result.available === true);
        if (who && result.available === true) {
          await refreshList();
          const id = await get<string>("settings", selectedKey(who.userId));
          if (typeof id === "string" && !controller.signal.aborted) await select(id);
        }
      } catch { if (!controller.signal.aborted) setError("Shared tables are unavailable. Your device-local plan is still available."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { mounted.current = false; controller.abort(); requestRef.current?.abort(); mutationRequest.current?.abort(); };
  }, [request, refreshList, select]);
  useEffect(() => {
    const changed = () => { const token = inviteTokenFromHash(window.location.hash); if (token) { setPendingInvite(token); setInvitation(null); } };
    window.addEventListener("hashchange", changed); return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!identity || !available || !pendingInvite) return; const controller = new AbortController();
    void request("/api/shared-tables/invites/preview", { token: pendingInvite }, undefined, controller.signal).then(body => { if (!controller.signal.aborted) setInvitation(body.invitation as SharedInvitationPreview); }).catch(() => { if (!controller.signal.aborted) setError("This invitation is expired, used or unavailable. Ask the host for a fresh link."); });
    return () => controller.abort();
  }, [identity, available, pendingInvite, request]);
  useEffect(() => {
    if (!table?.id) return;
    const tick = () => { if (document.visibilityState === "visible" && navigator.onLine && !mutationBusy.current) void refresh(); };
    const timer = setInterval(tick, 6000); window.addEventListener("online", tick); document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); window.removeEventListener("online", tick); document.removeEventListener("visibilitychange", tick); };
  }, [table?.id, refresh]);

  const mutate = useCallback(async (action: string, payload: Record<string, unknown> = {}, options: { tableId?: string; version?: number; key?: string; draftAction?: SharedChangeDraft["action"]; draftPayload?: SharedPreferences | SharedPlan } = {}) => {
    if (mutationBusy.current) { setError("A table change is still being confirmed. Please wait."); return null; }
    const current = tableRef.current, who = identityRef.current; if (!who) { setError("Sign in before changing a shared table."); return null; }
    if (!["create", "join"].includes(action) && (!options.tableId || current?.id !== options.tableId)) { setError("The displayed table changed. Review it before trying that action again."); return null; }
    mutationBusy.current = true; setBusy(true); setError("");
    const generation = selectionGeneration.current;
    const controller = new AbortController(); mutationRequest.current = controller;
    const operationKey = options.key ?? crypto.randomUUID(); const version = options.version ?? current?.version;
    const id = options.tableId ?? current?.id;
    const path = action === "create" ? "/api/shared-tables" : action === "join" ? "/api/shared-tables/join" : `/api/shared-tables/${id}/${action}`;
    const body = ["create", "join"].includes(action) ? payload : { version, ...payload };
    let pending: OfflineDraft<SharedChangeDraft> | undefined;
    try {
      if (options.draftAction && options.draftPayload && current) {
        pending = await saveDraft(current.id, who.userId, { action: options.draftAction, payload: options.draftPayload, baseVersion: version!, operationKey, conflict: false }, current.revision);
        if (!mounted.current || generation !== selectionGeneration.current) return null;
        setDraft(pending);
      }
      if (!navigator.onLine) throw new RequestError("offline", 0);
      const result = await request(path, body, operationKey, controller.signal);
      if (!mounted.current || generation !== selectionGeneration.current) return null;
      if (result.left) { tableRef.current = null; selectedRef.current = null; setTable(null); setStatus("local"); await deleteValue("settings", selectedKey(who.userId)); }
      else { if (!validSnapshot(result.table)) throw new RequestError("unavailable", 503); await adopt(result.table); }
      if (pending || options.draftAction) { if (id) await removeDraft(id, who.userId); setDraft(undefined); }
      void refreshList().catch(() => undefined); return result.table as SharedTableSnapshot | null;
    } catch (failure) {
      if (!mounted.current || generation !== selectionGeneration.current) return null;
      const conflict = failure instanceof RequestError && ["conflict", "idempotency_conflict"].includes(failure.code);
      if (pending && conflict) { pending = await saveDraft(pending.tableId, who.userId, { ...pending.value, conflict: true }, pending.baseRevision); setDraft(pending); }
      if (conflict) { setError("The shared table changed. Your draft is kept separately. Review the latest table before applying it."); await refresh(); }
      else if (failure instanceof RequestError && failure.status === 403) setError("Only the host can edit the plan. Each member can change and approve only their own seat.");
      else if (failure instanceof RequestError && failure.status === 401) setError("Sign in again before changing this shared table.");
      else if (failure instanceof RequestError && failure.code === "approval_required") setError("Every current member must approve this exact plan before the host can save it.");
      else if (failure instanceof RequestError && failure.code === "table_full") setError("This table already has six members.");
      else if (failure instanceof RequestError && failure.code === "invitation_unavailable") setError("This invitation is expired, revoked or already accepted. Ask the host for a new link.");
      else if (failure instanceof RequestError && failure.code === "plan_unfit") setError("This demo venue does not fit every current budget and listed dietary need.");
      else if (failure instanceof RequestError && failure.code === "details_unconfirmed") setError("Confirm that the restaurant’s missing menu, cost and dietary details still need checking before saving.");
      else setError(pending ? "Your change is saved as an unsynced device draft. Retry it explicitly when connected." : "The change was not confirmed. Refresh the table before trying again.");
      if (!(failure instanceof RequestError) || failure.status === 0 || failure.status >= 500) setStatus("offline"); return null;
    } finally { mutationBusy.current = false; if (mutationRequest.current === controller) mutationRequest.current = null; if (mounted.current) setBusy(false); }
  }, [adopt, refresh, refreshList, request]);
  const updatePreferences = (value: SharedPreferences, expectedVersion = table?.version) => { const target = sharedMutationTarget(table, expectedVersion); if (!target) return Promise.resolve(null); const own = sharedPreferencesOnly(value); return mutate("preferences", { preferences: own }, { ...target, draftAction: "preferences", draftPayload: own }); };
  const updatePlan = (value: SharedPlan, expectedVersion = table?.version) => { const target = sharedMutationTarget(table, expectedVersion); return target ? mutate("plan", { plan: value }, { ...target, draftAction: "plan", draftPayload: value }) : Promise.resolve(null); };
  const create = (title: string, preferences = defaultSharedPreferences(), plan?: SharedPlan) => mutate("create", { title, preferences: sharedPreferencesOnly(preferences), ...(plan ? { plan } : {}) });
  const approve = (approved: boolean) => { const target = sharedMutationTarget(table); return target ? mutate("approval", { approved }, target) : Promise.resolve(null); };
  const save = () => { const target = sharedMutationTarget(table); return target ? mutate("save", {}, target) : Promise.resolve(null); };
  const createInvite = async () => {
    const target = sharedMutationTarget(table); if (!target) return null;
    const token = createInvitationToken(); const confirmed = await mutate("invites", { token }, target);
    if (confirmed) { const link = `${window.location.origin}${window.location.pathname}#join/${token}`; setInviteLink(link); return link; } return null;
  };
  const acceptInvite = async (preferences = defaultSharedPreferences()) => {
    if (!pendingInvite) return null; const confirmed = await mutate("join", { token: pendingInvite, preferences: sharedPreferencesOnly(preferences) });
    if (confirmed) { setPendingInvite(null); setInvitation(null); window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#table`); } return confirmed;
  };
  const retryDraft = (rebase = false) => {
    if (!draft || draft.userId !== identityRef.current?.userId || draft.tableId !== table?.id) return Promise.resolve(null);
    const target = sharedMutationTarget(table, rebase ? table.version : draft.value.baseVersion); if (!target) return Promise.resolve(null);
    return mutate(draft.value.action, { [draft.value.action]: draft.value.payload }, { ...target, draftAction: draft.value.action, draftPayload: draft.value.payload, key: rebase ? crypto.randomUUID() : draft.value.operationKey });
  };
  const discardDraft = async () => { if (tableRef.current && identityRef.current) await removeDraft(tableRef.current.id, identityRef.current.userId); setDraft(undefined); };
  const disconnect = async () => { ++selectionGeneration.current; requestRef.current?.abort(); mutationRequest.current?.abort(); if (identityRef.current) await deleteValue("settings", selectedKey(identityRef.current.userId)); selectedRef.current = null; tableRef.current = null; etag.current = ""; setTable(null); setDraft(undefined); setInviteLink(""); setStatus("local"); };
  const displayedMutation = (action: string, payload: Record<string, unknown> = {}) => { const target = sharedMutationTarget(table); return target ? mutate(action, payload, target) : Promise.resolve(null); };
  return { identity, available, loading, busy, table, tables, status, error, draft, inviteLink, pendingInvite, invitation, refresh, refreshList, select, create, updatePreferences, updatePlan, approve, save, createInvite, acceptInvite, retryDraft, discardDraft, disconnect, revokeInvite: (inviteId: string) => displayedMutation("revoke-invite", { inviteId }), removeMember: (userId: string) => displayedMutation("remove-member", { userId }), leave: () => displayedMutation("leave") };
}
export type SharedTableSession = ReturnType<typeof useSharedTable>;
