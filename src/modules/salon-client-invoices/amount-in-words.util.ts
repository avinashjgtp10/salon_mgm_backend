// Indian numbering (lakh/crore) style, matching the frontend's own
// amountInWords() in BillingInvoicesPage.tsx — no `to-words`/`num-words`
// package exists in this repo, so this is a small local helper.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(num: number): string {
  if (num < 20) return ONES[num];
  return `${TENS[Math.floor(num / 10)]}${num % 10 ? " " + ONES[num % 10] : ""}`;
}

function threeDigits(num: number): string {
  if (num < 100) return twoDigits(num);
  return `${ONES[Math.floor(num / 100)]} Hundred${num % 100 ? " " + twoDigits(num % 100) : ""}`;
}

export function amountInWords(n: number): string {
  const rupees = Math.floor(n);
  if (rupees === 0) return "Rupees Zero Only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return `Rupees ${parts.join(" ")} Only`;
}
