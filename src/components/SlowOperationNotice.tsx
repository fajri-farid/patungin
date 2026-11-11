"use client";

import { useEffect, useState } from "react";

/** Mount only while an operation is pending so every attempt gets a fresh timer. */
export function SlowOperationNotice() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);
  return <p role="status" className="text-xs text-[#4A5B7C]">
    {slow ? "Sedikit lebih lama dari biasanya. Tunggu di halaman ini sebelum mencoba lagi." : ""}
  </p>;
}
