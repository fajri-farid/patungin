/**
 * Golden Fixtures Perhitungan (M-01 s/d M-07) & Preset Contoh Struk
 *
 * Sesuai .agents/plan/03-calculation-spec.md Bagian 12.
 */

import { computeFinancialInputHash } from "./hash";
import type { BillCalculationInput } from "./types";

function withConfirmedHash(input: Omit<BillCalculationInput, "confirmedInputHash">): BillCalculationInput {
  const hash = computeFinancialInputHash({
    currency: input.currency,
    confirmedGrandTotal: input.confirmedGrandTotal,
    items: input.items,
    adjustments: input.adjustments,
  });
  return {
    ...input,
    confirmedInputHash: hash,
  };
}

export interface GoldenFixturePreset {
  id: string;
  code: string;
  title: string;
  merchant: string;
  description: string;
  input: BillCalculationInput;
}

export const GOLDEN_FIXTURES: readonly GoldenFixturePreset[] = [
  {
    id: "m-01",
    code: "M-01",
    title: "Makan Siang Kantor",
    merchant: "Bakmi & Kopi Menteng",
    description: "Service Rp5.000 lalu Pajak Rp10.500 dihitung atas Item + Service.",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 115_500,
      participants: [
        { id: "p-ayu", allocationOrder: 0, name: "Ayu" },
        { id: "p-bima", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-ayu",
      items: [
        {
          id: "item-a",
          allocationOrder: 0,
          name: "Paket Bakmi Spesial",
          quantity: 1,
          unitPrice: 60_000,
          lineAmount: 60_000,
          reviewConfirmed: true,
        },
        {
          id: "item-b",
          allocationOrder: 1,
          name: "Nasi Ayam Jamur",
          quantity: 1,
          unitPrice: 40_000,
          lineAmount: 40_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        { itemId: "item-a", mode: "units", unitCounts: { "p-ayu": 1 } },
        { itemId: "item-b", mode: "units", unitCounts: { "p-bima": 1 } },
      ],
      adjustments: [
        {
          id: "adj-service",
          allocationOrder: 0,
          name: "Service Charge (5%)",
          kind: "service",
          amount: 5_000,
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          rateBps: 500,
          reviewConfirmed: true,
        },
        {
          id: "adj-tax",
          allocationOrder: 1,
          name: "PB1 / Pajak Restoran (10%)",
          kind: "tax",
          amount: 10_500,
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          dependsOnAdjustmentIds: ["adj-service"],
          scopeConfirmed: true,
          rateBps: 1000,
          reviewConfirmed: true,
        },
      ],
    }),
  },
  {
    id: "m-02",
    code: "M-02",
    title: "Promo Diskon Sebelum Biaya",
    merchant: "Bistro Senopati",
    description: "Diskon tagihan Rp10.000 mengurangi dasar sebelum Service 5% & Pajak 10%.",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 103_950,
      participants: [
        { id: "p-ayu", allocationOrder: 0, name: "Ayu" },
        { id: "p-bima", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-ayu",
      items: [
        {
          id: "item-a",
          allocationOrder: 0,
          name: "Spaghetti Carbonara",
          quantity: 1,
          unitPrice: 60_000,
          lineAmount: 60_000,
          reviewConfirmed: true,
        },
        {
          id: "item-b",
          allocationOrder: 1,
          name: "Chicken Parmigiana",
          quantity: 1,
          unitPrice: 40_000,
          lineAmount: 40_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        { itemId: "item-a", mode: "units", unitCounts: { "p-ayu": 1 } },
        { itemId: "item-b", mode: "units", unitCounts: { "p-bima": 1 } },
      ],
      adjustments: [
        {
          id: "adj-disc",
          allocationOrder: 0,
          name: "Diskon Member",
          kind: "bill-discount",
          amount: 10_000,
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          reviewConfirmed: true,
        },
        {
          id: "adj-service",
          allocationOrder: 1,
          name: "Service 5%",
          kind: "service",
          amount: null,
          amountSource: "derived",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          rateBps: 500,
          reviewConfirmed: true,
        },
        {
          id: "adj-tax",
          allocationOrder: 2,
          name: "Pajak 10%",
          kind: "tax",
          amount: null,
          amountSource: "derived",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          dependsOnAdjustmentIds: ["adj-service"],
          scopeConfirmed: true,
          rateBps: 1000,
          reviewConfirmed: true,
        },
      ],
    }),
  },
  {
    id: "m-03",
    code: "M-03",
    title: "Cemilan Bersama & Sisa Rupiah",
    merchant: "Warkop Kemang",
    description: "Rp10.000 dibagi rata 3 orang -> Rp3.334, Rp3.333, Rp3.333 (Largest Remainder).",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 10_000,
      participants: [
        { id: "p-a", allocationOrder: 0, name: "Ayu" },
        { id: "p-b", allocationOrder: 1, name: "Bima" },
        { id: "p-c", allocationOrder: 2, name: "Caca" },
      ],
      payerParticipantId: "p-a",
      items: [
        {
          id: "item-shared",
          allocationOrder: 0,
          name: "Pisang Goreng Keju Sharing",
          quantity: 1,
          unitPrice: 10_000,
          lineAmount: 10_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        {
          itemId: "item-shared",
          mode: "shared",
          participantIds: ["p-a", "p-b", "p-c"],
        },
      ],
      adjustments: [],
    }),
  },
  {
    id: "m-04",
    code: "M-04",
    title: "Pajak Parsial dengan Service",
    merchant: "Resto &Takeaway",
    description: "Service 5% semua item; Pajak 10% hanya pada Makanan A + Service dari Makanan A.",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 109_200,
      participants: [
        { id: "p-a", allocationOrder: 0, name: "Ayu" },
        { id: "p-b", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-a",
      items: [
        {
          id: "item-a",
          allocationOrder: 0,
          name: "Nasi Goreng Kambing (Dine-in)",
          quantity: 1,
          unitPrice: 40_000,
          lineAmount: 40_000,
          reviewConfirmed: true,
        },
        {
          id: "item-b",
          allocationOrder: 1,
          name: "Biji Kopi Kemasan (Bebas PB1)",
          quantity: 1,
          unitPrice: 60_000,
          lineAmount: 60_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        { itemId: "item-a", mode: "units", unitCounts: { "p-a": 1 } },
        { itemId: "item-b", mode: "units", unitCounts: { "p-b": 1 } },
      ],
      adjustments: [
        {
          id: "adj-service",
          allocationOrder: 0,
          name: "Service 5%",
          kind: "service",
          amount: 5_000,
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          rateBps: 500,
          reviewConfirmed: true,
        },
        {
          id: "adj-tax",
          allocationOrder: 1,
          name: "Pajak Makanan 10%",
          kind: "tax",
          amount: 4_200,
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a"],
          dependsOnAdjustmentIds: ["adj-service"],
          scopeConfirmed: true,
          rateBps: 1000,
          reviewConfirmed: true,
        },
      ],
    }),
  },
  {
    id: "m-05",
    code: "M-05",
    title: "Pajak Sudah Termasuk (Inclusive)",
    merchant: "Kafe Nusantara",
    description: "Harga gross Rp66.000 & Rp44.000 sudah termasuk pajak Rp10.000 (tidak ditambah dua kali).",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 110_000,
      participants: [
        { id: "p-a", allocationOrder: 0, name: "Ayu" },
        { id: "p-b", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-a",
      items: [
        {
          id: "item-a",
          allocationOrder: 0,
          name: "Beef Bowl (Termasuk Pajak)",
          quantity: 1,
          unitPrice: 66_000,
          lineAmount: 66_000,
          reviewConfirmed: true,
        },
        {
          id: "item-b",
          allocationOrder: 1,
          name: "Matcha Latte (Termasuk Pajak)",
          quantity: 1,
          unitPrice: 44_000,
          lineAmount: 44_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        { itemId: "item-a", mode: "units", unitCounts: { "p-a": 1 } },
        { itemId: "item-b", mode: "units", unitCounts: { "p-b": 1 } },
      ],
      adjustments: [
        {
          id: "adj-inc-tax",
          allocationOrder: 0,
          name: "PPN/PB1 Termasuk Harga",
          kind: "tax",
          amount: 10_000,
          amountSource: "observed",
          mode: "included",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          reviewConfirmed: true,
        },
      ],
    }),
  },
  {
    id: "m-06",
    code: "M-06",
    title: "Pembagian Per Unit (2:1)",
    merchant: "Es Teh Nusantara",
    description: "3 minuman total Rp30.000, Ayu 2 gelas (Rp20.000) dan Bima 1 gelas (Rp10.000).",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 30_000,
      participants: [
        { id: "p-a", allocationOrder: 0, name: "Ayu" },
        { id: "p-b", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-a",
      items: [
        {
          id: "item-drinks",
          allocationOrder: 0,
          name: "Es Teh Melati Jumbo",
          quantity: 3,
          unitPrice: 10_000,
          lineAmount: 30_000,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        {
          itemId: "item-drinks",
          mode: "units",
          unitCounts: { "p-a": 2, "p-b": 1 },
        },
      ],
      adjustments: [],
    }),
  },
  {
    id: "m-07",
    code: "M-07",
    title: "Penyesuaian Pembulatan Merchant",
    merchant: "Kopitiam Melawai",
    description: "Bagian awal Rp6.001 & Rp3.999 dengan tambahan pembulatan merchant +Rp1.",
    input: withConfirmedHash({
      currency: "IDR",
      confirmedGrandTotal: 10_001,
      participants: [
        { id: "p-a", allocationOrder: 0, name: "Ayu" },
        { id: "p-b", allocationOrder: 1, name: "Bima" },
      ],
      payerParticipantId: "p-a",
      items: [
        {
          id: "item-a",
          allocationOrder: 0,
          name: "Kopi Susu",
          quantity: 1,
          unitPrice: 6_001,
          lineAmount: 6_001,
          reviewConfirmed: true,
        },
        {
          id: "item-b",
          allocationOrder: 1,
          name: "Roti Kaya",
          quantity: 1,
          unitPrice: 3_999,
          lineAmount: 3_999,
          reviewConfirmed: true,
        },
      ],
      allocations: [
        { itemId: "item-a", mode: "units", unitCounts: { "p-a": 1 } },
        { itemId: "item-b", mode: "units", unitCounts: { "p-b": 1 } },
      ],
      adjustments: [
        {
          id: "adj-round",
          allocationOrder: 0,
          name: "Pembulatan Kasir",
          kind: "rounding",
          amount: 1,
          sign: "positive",
          amountSource: "observed",
          mode: "added",
          basis: "net",
          eligibleItemIds: ["item-a", "item-b"],
          scopeConfirmed: true,
          reviewConfirmed: true,
          reason: "Pembulatan tercetak di struk kasir",
        },
      ],
    }),
  },
];
