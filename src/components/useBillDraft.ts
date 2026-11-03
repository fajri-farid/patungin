"use client";

import { useEffect, useRef, useState } from "react";
import { saveDraftAction } from "@/app/actions/bills";
import type { SaveBillDraftPatch } from "@/server/store/repository";
import type { BillDocument } from "@/domain/billing/types";
import type { SaveStatus } from "./StepHeader";

/** Serialize saves and retain edits typed while an earlier request is in flight. */
export function useBillDraft(
  initialBill: BillDocument,
  buildPatch: (
    bill: BillDocument,
  ) => Omit<SaveBillDraftPatch, "expectedRevision">,
) {
  const [bill, setBill] = useState(initialBill);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef(initialBill);
  const revision = useRef(initialBill.revision);
  const editSequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<BillDocument | null>>(
    Promise.resolve(initialBill),
  );
  const patchBuilder = useRef(buildPatch);
  useEffect(() => {
    patchBuilder.current = buildPatch;
  }, [buildPatch]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (saveStatus === "saved") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveStatus]);

  const saveNow = (
    markReviewConfirmed = false,
  ): Promise<BillDocument | null> => {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current.status === "finalized")
      return Promise.resolve(latest.current);
    setSaveStatus("saving");
    const run = async () => {
      setSaveStatus("saving");
      const sequence = editSequence.current;
      try {
        const response = await saveDraftAction(latest.current.id, {
          ...patchBuilder.current(latest.current),
          expectedRevision: revision.current,
          markReviewConfirmed,
        });
        if (!response.ok || !response.data) {
          setSaveStatus("error");
          setSaveError(
            response.error ?? "Perubahan belum tersimpan. Coba simpan lagi.",
          );
          return null;
        }
        revision.current = response.data.revision;
        if (sequence === editSequence.current) {
          latest.current = response.data;
          setBill(response.data);
          setSaveStatus("saved");
        }
        setSaveError(null);
        return response.data;
      } catch {
        setSaveStatus("error");
        setSaveError(
          "Perubahan belum tersimpan. Periksa koneksi lalu coba simpan lagi.",
        );
        return null;
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  };

  const updateBillState = (
    updater: (bill: BillDocument) => BillDocument,
    markReviewConfirmed = false,
  ) => {
    if (latest.current.status === "finalized") return;
    const next = updater(latest.current);
    editSequence.current += 1;
    latest.current = next;
    setBill(next);
    setSaveStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveNow(markReviewConfirmed);
    }, 650);
  };

  const replaceBill = (next: BillDocument) => {
    latest.current = next;
    revision.current = next.revision;
    setBill(next);
    setSaveStatus("saved");
  };

  return { bill, saveStatus, saveError, updateBillState, saveNow, replaceBill };
}
