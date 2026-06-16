/**
 * Seed file: creates subscription plans on Razorpay and stores in subscription_plans.
 *
 * Run once:
 *   npx ts-node src/seeds/seed.plans.ts
 *
 * Test mode (₹100):
 *   $env:SEED_TEST_MODE="true"; npx ts-node src/seeds/seed.plans.ts
 *
 * Production (₹11,799):
 *   npx ts-node src/seeds/seed.plans.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import Razorpay from "razorpay";
import pool from "../config/database";

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const BASE_PRICE     = 9999;
const GST_RATE       = 0.18;
const PRICE_WITH_GST = Math.round(BASE_PRICE * (1 + GST_RATE)); // ₹11,799
const TEST_PRICE     = 100; // minimum for live subscriptions

const IS_TEST     = process.env.SEED_TEST_MODE === "true";
const FINAL_PRICE = IS_TEST ? TEST_PRICE : PRICE_WITH_GST;
const SLUG        = IS_TEST ? "salonox-pro-yearly-test" : "salonox-pro-yearly";

const PLAN = {
    name: "SalonOx Pro",
    slug: SLUG,
    description: `₹${BASE_PRICE.toLocaleString("en-IN")} + 18% GST per year. Everything you need to run your salon.`,
    price: FINAL_PRICE,
    billing_cycle: "yearly" as const,
    features: {
        appointments: true,
        client_management: true,
        staff_management: true,
        inventory: true,
        online_booking: true,
        whatsapp_marketing: true,
        analytics_reports: true,
        ai_features: true,
        multi_branch: true,
        priority_support: true,
    },
};

async function seedPlans() {
    console.log(`\n🌱 Seeding in ${IS_TEST ? `TEST mode (₹${TEST_PRICE})` : `PRODUCTION mode (₹${FINAL_PRICE})`}\n`);

    try {
        const { rows: existing } = await pool.query(
            "SELECT id, razorpay_plan_id FROM subscription_plans WHERE slug = $1",
            [PLAN.slug]
        );

        if (existing.length > 0 && existing[0].razorpay_plan_id) {
            console.log(`⏭  Plan already exists — razorpay_plan_id: ${existing[0].razorpay_plan_id}`);
            console.log("   Delete the row first to re-seed.");
            return;
        }

        console.log(`📡 Creating on Razorpay (₹${FINAL_PRICE})...`);
        const rzpPlan = await razorpay.plans.create({
            period: "yearly",
            interval: 1,
            item: {
                name: PLAN.name,
                amount: FINAL_PRICE * 100,
                currency: "INR",
                description: PLAN.description,
            },
        });

        console.log(`   ✅ Razorpay plan ID: ${rzpPlan.id}`);

        await pool.query(
            `INSERT INTO subscription_plans (
                name, slug, description, price, billing_cycle,
                razorpay_plan_id, max_branches, max_staff,
                max_bookings_per_month, ai_features_enabled,
                features, is_active
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
            ON CONFLICT (slug) DO UPDATE SET
                razorpay_plan_id       = EXCLUDED.razorpay_plan_id,
                price                  = EXCLUDED.price,
                description            = EXCLUDED.description,
                billing_cycle          = EXCLUDED.billing_cycle,
                features               = EXCLUDED.features,
                max_branches           = EXCLUDED.max_branches,
                max_staff              = EXCLUDED.max_staff,
                max_bookings_per_month = EXCLUDED.max_bookings_per_month,
                ai_features_enabled    = EXCLUDED.ai_features_enabled,
                is_active              = true`,
            [
                PLAN.name, PLAN.slug, PLAN.description,
                PLAN.price, PLAN.billing_cycle, rzpPlan.id,
                999, 999, 999999, true,
                JSON.stringify(PLAN.features),
            ]
        );

        console.log(`   ✅ Saved to DB\n`);
        console.log("✅ Done!");

    } catch (err: any) {
        console.error("❌ Failed:", err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

seedPlans().catch((err) => {
    console.error(err);
    process.exit(1);
});