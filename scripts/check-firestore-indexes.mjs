import { FieldPath } from "@google-cloud/firestore";

// Use an invented owner ID and limit each query to one result. This checks the
// same query shapes as the application without accessing a real user's bills.
export async function checkFirestoreQueryIndexes(firestore, probeOwner) {
  const queries = [
    {
      label: "Riwayat tagihan",
      run: () => firestore.collection("bills")
        .where("ownerUid", "==", probeOwner)
        .orderBy("updatedAt", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(1).get(),
    },
    {
      label: "Draft terakhir",
      run: () => firestore.collection("bills")
        .where("ownerUid", "==", probeOwner)
        .where("status", "==", "draft")
        .orderBy("updatedAt", "desc")
        .limit(1).get(),
    },
  ];

  return Promise.all(queries.map(async ({ label, run }) => {
    try {
      await run();
      return { label, status: "ready" };
    } catch (error) {
      const missingIndex = error && typeof error === "object" &&
        error.code === 9 && typeof error.details === "string" &&
        /index/i.test(error.details);
      return { label, status: missingIndex ? "missing" : "unavailable" };
    }
  }));
}
