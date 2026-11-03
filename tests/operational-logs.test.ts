import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { documents, firestore, queries } = await vi.hoisted(async () => {
  const { createAdminFirestoreFake } = await import("./helpers/admin-firestore");
  return createAdminFirestoreFake();
});
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireAdmin }));
vi.mock("@/server/firebase/admin", () => ({ getAdminFirestore: () => firestore }));
import { recordOperationalEvent } from "@/server/observability/events";
import { getLogsPage } from "@/server/admin/logs";
import { diagnoseScan, diagnoseCode, repeatedFlag } from "@/domain/diagnostics";
const now = Date.parse("2026-11-03T04:00:00Z");
let sequence = 0;
beforeEach(() => {
  sequence++; documents.clear(); queries.length=0;
  vi.useFakeTimers(); vi.setSystemTime(now + sequence * 300000);
  vi.stubEnv("FIREBASE_PROJECT_ID","test-project"); vi.stubEnv("FIREBASE_CLIENT_EMAIL","test@example.test"); vi.stubEnv("FIREBASE_PRIVATE_KEY","test-only");
  requireAdmin.mockReset(); requireAdmin.mockResolvedValue({uid:"admin"});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("operational coalescing and privacy", () => {
  it("bounds 1000 repeated rejections to four checkpoint transactions in a warm worker", async () => {
    const spy = vi.spyOn(firestore, "runTransaction");
    for(let i=0;i<1000;i++) await recordOperationalEvent({ownerUid:"repeat-"+sequence,code:"MONTHLY_QUOTA_REACHED",stage:"quota",providerCalled:false,quotaReserved:false});
    expect(spy).toHaveBeenCalledTimes(4);
    const records=[...documents.values()];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({count:100,flag:"QUOTA_REJECTED",level:"attention",providerCalled:false,quotaReserved:false});
    expect(repeatedFlag("MONTHLY_QUOTA_REACHED",100)).toBe("REPEATED_REJECTIONS");
  });
  it("keeps concurrent checkpoints from losing counts", async () => {
    await Promise.all(Array.from({length:25},()=>recordOperationalEvent({ownerUid:"concurrent-"+sequence,code:"RATE_LIMIT_MINUTE",stage:"quota"})));
    expect([...documents.values()][0].count).toBe(25);
  });
  it("does not let logging failure replace the original operation, and excludes raw data from fallback", async () => {
    const consoleSpy=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    vi.spyOn(firestore,"runTransaction").mockRejectedValueOnce(new Error("PRIVATE_API_KEY"));
    await expect(recordOperationalEvent({ownerUid:"failure-"+sequence,code:"UNEXPECTED_ERROR",stage:"persistence",requestId:"request-1",...{errorMessage:"PRIVATE_RECEIPT",token:"PRIVATE_TOKEN"}})).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toMatch(/PRIVATE/);
  });
  it("does not persist unverified/invalid identity or unknown raw event codes", async () => {
    await recordOperationalEvent({ownerUid:"",code:"MONTHLY_QUOTA_REACHED",stage:"quota"});
    expect(documents.size).toBe(0);
    await recordOperationalEvent({ownerUid:"valid-"+sequence,code:"secret-value-not-a-code",stage:"quota"});
    expect([...documents.values()][0].code).toBe("UNEXPECTED_ERROR");
    expect(JSON.stringify([...documents.values()])).not.toContain("secret-value-not-a-code");
  });
});
describe("paged logs", () => {
  it("rejects access before any query",async()=>{
    requireAdmin.mockRejectedValue(new Error("ADMIN_REQUIRED"));
    await expect(getLogsPage({category:"events",period:"today"})).rejects.toThrow("ADMIN_REQUIRED");
    expect(queries).toEqual([]);
  });
  it("filters failures across all scans rather than the currently loaded page",async()=>{
    for(let i=0;i<60;i++) documents.set("scanAttempts/scan-"+String(i).padStart(3,"0"),{
      ownerUid:"owner",billId:"bill",state:i<30?"succeeded":"failed",reservedAt:new Date(Date.now()-i*1000).toISOString(),completedAt:new Date(Date.now()).toISOString(),
      errorCode:i<30?null:"PROVIDER_ERROR",model:"test",errorMessage:"PRIVATE_ERROR",extractedData:"PRIVATE_DATA"
    });
    const first=await getLogsPage({category:"scans",period:"today",filter:"failed"});
    expect(first.category).toBe("scans");
    if(first.category!=="scans")throw new Error();
    expect(first.scans).toHaveLength(25);expect(first.scans.every(s=>s.state==="failed")).toBe(true);
    const second=await getLogsPage({category:"scans",period:"today",filter:"failed",after:first.next!});
    expect(second.category==="scans"&&second.scans.length).toBe(5);
    expect(queries.every(q=>q.maximum===26)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("PRIVATE");
  });
  it("includes unfinished records while preserving derived uncertainty",async()=>{
    for(const [id,state] of [["one","dispatched"],["two","reserved"],["three","failed"]]){
      documents.set("scanAttempts/"+id,{id,ownerUid:"owner",billId:"bill",state,reservedAt:new Date(Date.now()-120000).toISOString(),completedAt:null,errorCode:null,model:"test"});
    }
    const page=await getLogsPage({category:"scans",period:"today",filter:"processing"});
    expect(page.category==="scans"&&page.scans.length).toBe(2);
  });
  it("paginates equal timestamps without duplicates and binds cursors to filters",async()=>{
    for(let i=0;i<55;i++)documents.set("operationalEvents/event-"+String(i).padStart(3,"0"),{
      ownerUid:"owner",code:"PROVIDER_ERROR",level:"error",stage:"provider",firstAt:new Date(Date.now()-1000).toISOString(),
      lastAt:new Date(Date.now()).toISOString(),count:1,requestId:"ref",billId:null,attemptId:null,
      providerCalled:true,quotaReserved:true,deleteAfter:new Date(),raw:"PRIVATE"
    });
    const first=await getLogsPage({category:"events",period:"today",filter:"error"});
    const second=await getLogsPage({category:"events",period:"today",filter:"error",after:first.next!});
    const third=await getLogsPage({category:"events",period:"today",filter:"error",after:second.next!});
    if(first.category!=="events"||second.category!=="events"||third.category!=="events")throw new Error();
    expect(new Set([...first.events,...second.events,...third.events].map(e=>e.id)).size).toBe(55);
    expect(third.next).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE|deleteAfter/);
    await expect(getLogsPage({category:"events",period:"week",filter:"error",after:first.next!})).rejects.toMatchObject({code:"INVALID_CURSOR"});
  });
  it("reads only audits for the admin-changes category and excludes TTL",async()=>{
    documents.set("accountAudits/audit",{id:"audit",ownerUid:"owner",actorUid:"admin",actorEmail:"admin@example.test",createdAt:new Date(Date.now()).toISOString(),monthKey:"2026-11",before:{bonus:0},after:{bonus:5},deleteAfter:new Date(),private:"PRIVATE"});
    const page=await getLogsPage({category:"changes",period:"today"});
    expect(queries.map(q=>q.collection)).toEqual(["accountAudits"]);
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|deleteAfter/);
  });
});
describe("human explanations",()=>{
  const base={state:"succeeded",reservedAt:new Date(now).toISOString(),completedAt:new Date(now).toISOString(),errorCode:null};
  it("distinguishes successful extraction from applying it to a draft",()=>{
    expect(diagnoseScan({...base,applicationOutcome:"applied"},now).flag).toBe("SCAN_SUCCEEDED");
    expect(diagnoseScan({...base,applicationOutcome:"draft_changed"},now)).toMatchObject({flag:"RESULT_NOT_APPLIED",explanation:expect.stringContaining("Draft berubah")});
    expect(diagnoseScan(base,now).flag).toBe("APPLICATION_NOT_RECORDED");
  });
  it("explains actual timeout codes and does not invent a failure for unfinished scans",()=>{
    expect(diagnoseScan({...base,state:"unknown",errorCode:"PROVIDER_TIMEOUT"},now).title).toContain("batas waktu");
    expect(diagnoseScan({...base,state:"dispatched",completedAt:null},now+120000).flag).toBe("COMPLETION_MISSING");
    expect(diagnoseCode("GEMINI_TIMEOUT").flag).toBe("PROVIDER_TIMEOUT");
    expect(diagnoseCode("UNRECOGNIZED").flag).toBe("UNCLASSIFIED");
  });
});
