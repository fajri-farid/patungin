import { afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import sharp from "sharp";
const mocks=vi.hoisted(()=>({origin:vi.fn(),identity:vi.fn(),host:vi.fn(),reserve:vi.fn(),complete:vi.fn(),extract:vi.fn(),record:vi.fn(),server:vi.fn()}));
vi.mock("@/server/auth/session",async(importOriginal)=>({...await importOriginal<typeof import("@/server/auth/session")>(),verifyRequestOrigin:mocks.origin,requireSessionIdentity:mocks.identity,requireAuthenticatedHost:mocks.host}));
vi.mock("@/server/store/repository",async(importOriginal)=>({...await importOriginal<typeof import("@/server/store/repository")>(),reserveScanAttempt:mocks.reserve,completeScanAttempt:mocks.complete}));
vi.mock("@/server/scans/gemini",async(importOriginal)=>({...await importOriginal<typeof import("@/server/scans/gemini")>(),extractReceiptWithGemini:mocks.extract}));
vi.mock("@/server/observability/events",()=>({recordOperationalEvent:mocks.record,serverDiagnostic:mocks.server}));
import { POST } from "@/app/api/bills/[id]/scan/route";
import { AppServiceError } from "@/server/store/repository";
import { AuthGuardError } from "@/server/auth/session";
let receiptBytes: Uint8Array<ArrayBuffer>;
beforeAll(async()=>{
 receiptBytes=new Uint8Array(await sharp({create:{width:32,height:32,channels:3,background:"white"}}).jpeg().toBuffer());
});
function request(missing=false,bytes=receiptBytes){
 const form=new FormData();form.set("idempotencyKey","test-idempotent");form.set("expectedRevision","1");
 if(!missing)form.set("receipt",new File([bytes],"receipt.jpg",{type:"image/jpeg"}));
 return new Request("http://localhost:3000/api/bills/bill/scan",{method:"POST",headers:{origin:"http://localhost:3000"},body:form});
}
const context={params:Promise.resolve({id:"bill"})};
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.origin.mockResolvedValue(undefined);mocks.identity.mockResolvedValue({uid:"owner",email:"owner@example.test"});mocks.host.mockResolvedValue({uid:"owner"});
 mocks.reserve.mockResolvedValue({attempt:{id:"scan",state:"dispatched"},isDuplicate:false});
 mocks.extract.mockResolvedValue({items:[],adjustments:[]});
 mocks.complete.mockResolvedValue({attempt:{id:"scan",state:"succeeded"},appliedToBill:true});
 mocks.record.mockResolvedValue(undefined);
});
afterEach(()=>{vi.unstubAllEnvs();});
describe("scan route diagnostics",()=>{
 it("rejects fake image headers before reserving quota or calling the provider",async()=>{
  const response=await POST(request(false,new Uint8Array([0xff,0xd8,0xff,0x01])),context);
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("INVALID_IMAGE");
  expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"INVALID_IMAGE",stage:"validation",providerCalled:false,quotaReserved:false}));
 });
 it("rejects excessive pixel counts before reserving quota or calling the provider",async()=>{
  const image=await sharp({create:{width:4001,height:4000,channels:3,background:"white"}}).png().toBuffer();
  const response=await POST(request(false,new Uint8Array(image)),context);
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("IMAGE_RESOLUTION_TOO_LARGE");
  expect(mocks.reserve).not.toHaveBeenCalled();expect(mocks.extract).not.toHaveBeenCalled();
 });
 it("rejects oversized chunked multipart bodies before parsing or reserving AI quota",async()=>{
  let cancelled=false;
  const stream=new ReadableStream({
   pull(controller){controller.enqueue(new Uint8Array(256*1024));},
   cancel(){cancelled=true;},
  });
  const oversized=new Request("http://localhost:3000/api/bills/bill/scan",{
   method:"POST",headers:{origin:"http://localhost:3000","content-type":"multipart/form-data; boundary=oversized"},
   body:stream,duplex:"half",
  } as RequestInit);
  const response=await POST(oversized,context);
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.extract).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toContain("no-store");
 });
 it("records quota rejection without calling Gemini or charging another attempt",async()=>{
  mocks.reserve.mockRejectedValue(new AppServiceError(429,"MONTHLY_QUOTA_REACHED","Kuota habis"));
  const response=await POST(request(),context);
  expect(response.status).toBe(429);expect(mocks.extract).not.toHaveBeenCalled();expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"MONTHLY_QUOTA_REACHED",stage:"quota",providerCalled:false,quotaReserved:false}));
  expect((await response.json()).requestId).toBeTruthy();
 });
 it("records invalid input before reserving quota",async()=>{
  const response=await POST(request(true),context);
  expect(response.status).toBe(400);expect(mocks.reserve).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"MISSING_FILE",providerCalled:false,quotaReserved:false}));
 });
 it("does not mislabel a successful provider result as a provider failure if persistence fails",async()=>{
  mocks.complete.mockRejectedValue(new Error("database unavailable PRIVATE_SECRET"));
  const response=await POST(request(),context);
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("PERSISTENCE_FAILED");
  expect(mocks.complete).toHaveBeenCalledTimes(1);
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"PERSISTENCE_FAILED",stage:"persistence",quotaReserved:true}));
 });
 it("keeps provider timeout distinct from persistence failure",async()=>{
  mocks.extract.mockRejectedValue(new AppServiceError(504,"PROVIDER_TIMEOUT","Timeout"));
  const response=await POST(request(),context);
  expect(response.status).toBe(504);
  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({state:"unknown",errorCode:"PROVIDER_TIMEOUT"}));
  expect(mocks.record).not.toHaveBeenCalled();
 });
 it("records persistence failure when the provider error cannot be saved",async()=>{
  mocks.extract.mockRejectedValue(new AppServiceError(503,"PROVIDER_ERROR","Provider failure"));
  mocks.complete.mockRejectedValue(new Error("DB"));
  const response=await POST(request(),context);
  expect((await response.json()).code).toBe("PERSISTENCE_FAILED");
  expect(mocks.record).toHaveBeenCalledTimes(1);
 });
 it("preserves uncertainty if quota transaction transport fails",async()=>{
  mocks.reserve.mockRejectedValue(new Error("Connection closed"));
  await POST(request(),context);
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"DATABASE_FAILED",quotaReserved:null,providerCalled:false}));
  expect(mocks.extract).not.toHaveBeenCalled();
 });
 it("reuses a duplicate request without another AI call",async()=>{
  mocks.reserve.mockResolvedValue({attempt:{id:"scan",state:"succeeded"},isDuplicate:true});
  const response=await POST(request(),context);
  expect(response.status).toBe(200);expect(mocks.extract).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({code:"DUPLICATE_REQUEST",quotaReserved:false,providerCalled:false}));
 });
 it("never creates Firestore logs for anonymous requests",async()=>{
  mocks.identity.mockRejectedValue(new AuthGuardError(401,"UNAUTHENTICATED","Login"));
  const response=await POST(request(),context);
  expect(response.status).toBe(401);expect(mocks.record).not.toHaveBeenCalled();expect(mocks.reserve).not.toHaveBeenCalled();
 });
});
