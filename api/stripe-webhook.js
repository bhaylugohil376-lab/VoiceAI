
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

let stripe = null;
let supabaseAdmin = null;

function getStripe() {
  if (stripe) return stripe;

  const secret = process.env.STRIPE_SECRET_KEY;

  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  stripe = new Stripe(secret);
  return stripe;
}

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase server credentials are not configured."
    );
  }

  supabaseAdmin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return supabaseAdmin;
}

function getUserId(object) {
  const metadataUserId = object?.metadata?.user_id;

  if (
    typeof metadataUserId === "string" &&
    metadataUserId.trim()
  ) {
    return metadataUserId.trim();
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return res.status(400).json({
      success: false,
      error: "Stripe webhook signature configuration is missing."
    });
  }

  let event;

  try {
    const stripeClient = getStripe();

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        success: false,
        error: "Webhook requires the raw request body."
      });
    }

    event = stripeClient.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error(
      "Stripe signature verification failed:",
      error.message
    );

    return res.status(400).json({
      success: false,
      error: "Invalid Stripe webhook signature."
    });
  }

  try {
    const db = getSupabaseAdmin();

    // Process only events this handler explicitly supports.
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Only activate Premium for a paid checkout.
        if (
          session.mode !== "subscription" ||
          !["paid", "no_payment_required"].includes(session.payment_status)
        ) {
          break;
        }

        const userId = getUserId(session);

        if (!userId) {
          console.error(
            "Checkout session is missing metadata.user_id:",
            session.id
          );

          return res.status(400).json({
            success: false,
            error: "Checkout session has no associated user."
          });
        }

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (!subscriptionId) {
          return res.status(400).json({
            success: false,
            error: "Subscription ID is missing."
          });
        }

        const subscription = await getStripe().subscriptions.retrieve(
          subscriptionId
        );

        // Do not trust client-provided plan details.
        if (
          subscription.status !== "active" &&
          subscription.status !== "trialing"
        ) {
          break;
        }

        const subscriptionUserId = getUserId(subscription);

        if (
          subscriptionUserId &&
          subscriptionUserId !== userId
        ) {
          return res.status(400).json({
            success: false,
            error: "Subscription user does not match checkout user."
          });
        }

        const { error } = await db
          .from("profiles")
          .update({
            plan: "premium",
            stripe_customer_id:
              typeof session.customer === "string"
                ? session.customer
                : session.customer?.id,
            stripe_subscription_id: subscription.id
          })
          .eq("id", userId);

        if (error) {
          console.error(
            "Premium activation failed:",
            error.message
          );

          return res.status(500).json({
            success: false,
            error: "Unable to update subscription."
          });
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const userId = getUserId(subscription);

        if (!userId) {
          console.warn(
            "Subscription update missing metadata.user_id:",
            subscription.id
          );
          break;
        }

        const active =
          subscription.status === "active" ||
          subscription.status === "trialing";

        const { error } = await db
          .from("profiles")
          .update({
            plan: active ? "premium" : "free",
            stripe_subscription_id: subscription.id
          })
          .eq("id", userId);

        if (error) {
          console.error(
            "Subscription update failed:",
            error.message
          );

          return res.status(500).json({
            success: false,
            error: "Unable to update subscription."
          });
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const userId = getUserId(subscription);

        if (!userId) {
          console.warn(
            "Deleted subscription missing metadata.user_id:",
            subscription.id
          );
          break;
        }

        const { error } = await db
          .from("profiles")
          .update({ plan: "free" })
          .eq("id", userId)
          .eq("stripe_subscription_id", subscription.id);

        if (error) {
          console.error(
            "Subscription cancellation update failed:",
            error.message
          );

          return res.status(500).json({
            success: false,
            error: "Unable to update cancelled subscription."
          });
        }

        break;
      }

      default:
        // Unknown or unrelated events need no action.
        break;
    }

    return res.status(200).json({
      success: true,
      received: true,
      event_id: event.id
    });
  } catch (error) {
    console.error(
      "Stripe webhook processing error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      error: "Webhook processing failed."
    });
  }
}
