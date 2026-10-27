import { z } from 'zod';

export const Verdict = z.enum(['ALLOW', 'STEP_UP', 'HOLD']);
export type Verdict = z.infer<typeof Verdict>;

export const AMOUNT_BANDS = ['UNDER_1K', '1K_TO_10K', '10K_TO_1L', '1L_TO_5L', 'ABOVE_5L'] as const;
export const AmountBand = z.enum(AMOUNT_BANDS);
export type AmountBand = z.infer<typeof AmountBand>;

export const PayeeNovelty = z.enum(['KNOWN', 'RECENT', 'FIRST_SEEN']);
export type PayeeNovelty = z.infer<typeof PayeeNovelty>;

const RUPEE = 100; // paise

/** Coarse amount band. The attestation carries the band, never a precise figure. */
export function amountBandFor(amountPaise: number): AmountBand {
  if (amountPaise < 1_000 * RUPEE) return 'UNDER_1K';
  if (amountPaise < 10_000 * RUPEE) return '1K_TO_10K';
  if (amountPaise < 1_00_000 * RUPEE) return '10K_TO_1L';
  if (amountPaise < 5_00_000 * RUPEE) return '1L_TO_5L';
  return 'ABOVE_5L';
}

export const AMOUNT_BAND_LABEL: Record<AmountBand, string> = {
  UNDER_1K: 'Under ₹1,000',
  '1K_TO_10K': '₹1,000 – ₹10,000',
  '10K_TO_1L': '₹10,000 – ₹1 lakh',
  '1L_TO_5L': '₹1 lakh – ₹5 lakh',
  ABOVE_5L: 'Above ₹5 lakh',
};

export const PAYEE_NOVELTY_LABEL: Record<PayeeNovelty, string> = {
  KNOWN: 'Paid before',
  RECENT: 'Paid only recently',
  FIRST_SEEN: 'Never paid before',
};

/** Indian digit grouping: 200000 rupees -> "₹2,00,000". */
export function formatRupees(amountPaise: number): string {
  const rupees = amountPaise / RUPEE;
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
