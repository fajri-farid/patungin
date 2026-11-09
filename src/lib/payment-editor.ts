import type { PaymentMethodNote } from "@/domain/billing/types";

export interface PaymentEditor {
  id: string;
  label: string;
  payment: PaymentMethodNote;
}

export function paymentEditorChanged(editor: PaymentEditor | null, original?: PaymentEditor): boolean {
  if (!editor) return false;
  const before = original?.payment ?? { method: "bank" };
  const keys = ["method", "bankOrWalletName", "accountNumber", "accountHolderName", "note", "qrisImageId"] as const;
  return editor.label !== (original?.label ?? "") || keys.some(
    (key) => (editor.payment[key] ?? "") !== (before[key] ?? ""),
  );
}
