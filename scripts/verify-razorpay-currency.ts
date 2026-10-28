/*
 * Checks whether THIS Razorpay account (the keys in .env) can create a recurring subscription plan in a given currency, before that
 * currency is enabled for customers.
 *
 *   npx ts-node scripts/verify-razorpay-currency.ts USD            -> dry run: only shows the account/mode and what it would do
 *   npx ts-node scripts/verify-razorpay-currency.ts USD --create   -> really creates ONE plan (amount 1.00, "SalonOx currency check")
 *
 * Razorpay plans cannot be deleted, so --create leaves a small unused plan behind on the account; run it against TEST keys first.
 * Creating a plan only proves the account accepts the currency for plans. Razorpay must also have international payments and
 * recurring (subscription) payments enabled for the customer's card/network: confirm that with Razorpay support or in the
 * dashboard (Settings > Payment Methods / International Payments) and with a real test subscription before listing the
 * currency in RAZORPAY_SUBSCRIPTION_CURRENCIES.
 */
import "dotenv/config";
import { createRazorpayPlan, getRazorpay, getRazorpayCredentials } from "../src/config/razorpay";

(async () => {
  const currency = (process.argv[2] ?? "").toUpperCase();
  const create = process.argv.includes("--create");
  if (!/^[A-Z]{3}$/.test(currency)) {
    console.error("Usage: verify-razorpay-currency.ts <CURRENCY, e.g. USD> [--create]");
    process.exit(1);
  }
  // The key the server would really use: the one saved under Plans > Payment Gateway, else the environment.
  const { keyId: savedOrEnvKey, sources } = await getRazorpayCredentials();
  const keyId = savedOrEnvKey ?? "";
  console.log(`Key source: ${sources.keyId ?? "none"}`);
  console.log(`Razorpay account key: ${keyId.slice(0, 9)}… (${keyId.startsWith("rzp_live") ? "LIVE" : keyId.startsWith("rzp_test") ? "TEST" : "unknown mode"})`);
  console.log(`Currency to check: ${currency}`);
  if (!create) {
    console.log("Dry run: nothing was created. Re-run with --create to create one 1.00 test plan in that currency.");
    return;
  }
  try {
    const id = await createRazorpayPlan({ name: `SalonOx currency check (${currency})`, description: "Currency support check, not for sale.", period: "monthly", interval: 1, amountRupees: 1, currency });
    const plan: any = await (await getRazorpay()).plans.fetch(id);
    console.log(`OK: Razorpay created plan ${plan.id} in ${plan.item?.currency} (${plan.item?.amount} minor units).`);
    console.log(`Next: confirm international + recurring payments are enabled, test a real subscription, then add ${currency} to RAZORPAY_SUBSCRIPTION_CURRENCIES.`);
  } catch (err: any) {
    console.error(`NOT SUPPORTED: ${err?.message ?? err}`);
    console.error(`Do not add ${currency} to RAZORPAY_SUBSCRIPTION_CURRENCIES; customers there stay billed in INR.`);
    process.exitCode = 2;
  }
})().finally(() => process.exit());
