
import Stripe from "stripe";
import { requireAuth } from "./_lib/auth.js";
import {
  requireMethod,
  parseJsonBody,
  sendError
} from "./_lib/response.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, ["POST"])) {
    return;
  }

  try {
    const user = await requireAuth(req, res);

    if (!user) {
      return;
    }

    const body = parseJsonBody(req);

    if (!body || typeof body !== "object") {
      return sendError(res, 400, "Send a valid JSON request.");
    }

    const interval =
      typeof body.interval === "string"
        ? body.interval.trim().toLowerCase()
        : "";

    if (!["monthly", "yearly"].includes(interval)) {
      return sendError(
        res,
        400,
        "Choose a monthly or yearly subscription."
      );
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.APP_URL;

    const priceId =
      interval === "monthly"
        ? process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID
        : process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID;

    if (!secretKey || !appUrl || !priceId) {
      return sendError(
        res,
        503,
        "Stripe checkout is not fully configured."
      );
    }

    if (!priceId.startsWith("price_")) {
      return sendError(res, 500, "Stripe Price ID is invalid.");
    }

    let baseUrl;

    try {
      baseUrl = new URL(appUrl);
    } catch {
      return sendError(res, 500, "APP_URL is invalid.");
    }

    if (
      baseUrl.protocol !== "https:" &&
      process.env.NODE_ENV === "production"
    ) {
      return sendError(
        res,
        500,
        "Production APP_URL must use HTTPS."
      );
    }

    const stripe = new Stripe(secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: {
        user_id: user.id,
        plan: "premium",
        billing_interval: interval
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan: "premium",
          billing_interval: interval
        }
      },
      success_url: new URL(
        "/pricing.html?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        baseUrl
      ).toString(),
      cancel_url: new URL(
        "/pricing.html?checkout=cancelled",
        baseUrl
      ).toString()
    });

    if (!session.url) {
      return sendError(
        res,
        502,
        "Stripe did not return a checkout URL."
      );
    }

    return res.status(200).json({
      success: true,
      checkout_url: session.url,
      session_id: session.id
    });
  } catch (error) {
    console.error("Stripe checkout error:", error.message);

    if (error.type === "StripeAuthenticationError") {
      return sendError(res, 500, "Stripe secret key is invalid.");
    }

    return sendError(
      res,
      500,
      "Could not create the checkout session."
    );
  }
}
