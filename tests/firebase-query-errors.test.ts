import { describe, expect, it } from "vitest";
import { classifyQueryError } from "@/server/firebase/query-errors";
import fs from "node:fs";
describe("safe database query diagnostics",()=>{
 it.each([9,"failed-precondition"])("explains missing/building indexes for %s without leaking console links",code=>{
  const result=classifyQueryError({code,details:"The query requires an index: https://console.example/PRIVATE_PROJECT_TOKEN"});
  expect(result?.code).toBe("DATABASE_INDEX_REQUIRED");
  expect(result?.message).toContain("firestore.indexes.json");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
 });
 it("does not mislabel every failed precondition as an index problem",()=>{
  expect(classifyQueryError({code:9,message:"Another precondition failed"})).toBeNull();
 });
 it.each([7,"permission-denied"])("distinguishes database permissions for %s",code=>{
  expect(classifyQueryError({code,message:"PRIVATE_CREDENTIAL"})).toMatchObject({code:"DATABASE_PERMISSION_DENIED"});
 });
 it.each([14,4,"unavailable","deadline-exceeded"])("distinguishes temporary database failures for %s",code=>{
  expect(classifyQueryError({code})).toMatchObject({code:"DATABASE_UNAVAILABLE"});
 });
 it("does not expose unknown errors",()=>{
  expect(classifyQueryError(new Error("PRIVATE_KEY"))).toBeNull();
  expect(classifyQueryError(null)).toBeNull();
 });
 it("keeps the timestamp index used by the global audit page enabled",()=>{
  const config=JSON.parse(fs.readFileSync("firestore.indexes.json","utf8"));
  const override=config.fieldOverrides.find((v:{collectionGroup:string;fieldPath:string})=>v.collectionGroup==="accountAudits"&&v.fieldPath==="createdAt");
  expect(override===undefined||override.indexes.some((v:{order:string;queryScope:string})=>v.order==="DESCENDING"&&v.queryScope==="COLLECTION")).toBe(true);
 });
});
