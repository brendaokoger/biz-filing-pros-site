'use strict';

// ---------------------------------------------------------------------------
// All prices sourced directly from intake.html — do not edit independently
// ---------------------------------------------------------------------------

const PACKAGES = {
  essentials: {
    label:       'Business Starter Package',
    stripeLabel: 'Biz Filing Pros Business Starter Package',
    basePrice:   275,   // pickPkg(this,'essentials',275)
    includesStateFee: false,
  },
  complete: {
    label:       'Business Pro Package',
    stripeLabel: 'Biz Filing Pros Business Pro Package',
    basePrice:   1549,  // pickPkg(this,'complete',1549)
    // State fees included except PRO_EXCLUDED_STATES
  },
};

// Source: LLC_STATE_FEES in intake.html
// California $890 = Articles $70 + Statement of Info $20 + Franchise Tax $800
const STATE_FEES = {
  'Alabama': 200, 'Alaska': 250, 'Arizona': 50, 'Arkansas': 45, 'California': 890,
  'Colorado': 50, 'Connecticut': 120, 'Delaware': 90, 'Florida': 125, 'Georgia': 100,
  'Hawaii': 50, 'Idaho': 100, 'Illinois': 150, 'Indiana': 95, 'Iowa': 50,
  'Kansas': 160, 'Kentucky': 40, 'Louisiana': 100, 'Maine': 175, 'Maryland': 100,
  'Massachusetts': 500, 'Michigan': 50, 'Minnesota': 155, 'Mississippi': 50, 'Missouri': 50,
  'Montana': 35, 'Nebraska': 100, 'Nevada': 75, 'New Hampshire': 100, 'New Jersey': 125,
  'New Mexico': 50, 'New York': 200, 'North Carolina': 125, 'North Dakota': 135, 'Ohio': 99,
  'Oklahoma': 100, 'Oregon': 100, 'Pennsylvania': 125, 'Rhode Island': 150, 'South Carolina': 110,
  'South Dakota': 150, 'Tennessee': 300, 'Texas': 300, 'Utah': 54, 'Vermont': 125,
  'Virginia': 100, 'Washington': 200, 'Washington D.C.': 99, 'West Virginia': 100,
  'Wisconsin': 130, 'Wyoming': 100,
};

// Source: PRO_EXCLUDED_FEES in intake.html
// Business Pro does NOT include the filing fee for these states
const PRO_EXCLUDED_FEES = {
  'California': 890, 'Nevada': 75, 'Texas': 300, 'Tennessee': 300,
  'Massachusetts': 500, 'Alaska': 250, 'Maryland': 100, 'Maine': 175,
  'Washington': 200, 'Washington D.C.': 99,
};

// Source: toggleAddon() calls in intake.html
// Note: ao_statetm toggleAddon uses 250 even though the display label reads "$249"
const ADDONS = {
  ao_expedited: { name: 'Expedited Filing',                                      price: 149  },
  ao_ra:        { name: 'Registered Agent (1 Year)',                             price: 149  },
  ao_oa_sm:     { name: 'Operating Agreement — Single Member',                   price: 99   },
  ao_oa:        { name: 'Operating Agreement / Bylaws — Multi-Member or Corp',   price: 149  },
  ao_statetm:   { name: 'State Trademark (1 Class)',                             price: 250  },
  ao_fedtm:     { name: 'Federal Trademark (1 Class)',                           price: 1099 },
  ao_email:     { name: 'Business Email Setup',                                  price: 149  },
  ao_web:       { name: 'Launch Site (One-Page Website)',                        price: 749  },
  ao_duns:      { name: 'DUNS Number Registration',                              price: 49   },
};

// Add-ons bundled into Business Pro — cannot be charged as extras
const COMPLETE_INCLUDED_ADDONS = new Set([
  'ao_ra', 'ao_oa_sm', 'ao_oa', 'ao_expedited', 'ao_email', 'ao_duns',
]);

// Address selection charges (separate from ao_ra add-on)
// Source: addrSelections logic in intake.html submit handler
const ADDR_RA_PRICE      = 149;   // addrRA when not complete package
const ADDR_VIRTUAL_MONTHLY = 39;  // virtualBillingChoice === 'monthly'
const ADDR_VIRTUAL_ANNUAL  = 399; // virtualBillingChoice === 'annual'

const VALID_ENTITY_TYPES = new Set(['LLC', 'S-Corp', 'C-Corp']);

const CHECKOUT_DESCRIPTION =
  'Business formation package payment including selected package, ' +
  'applicable state filing fees, and selected add-ons.';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.bizfilingpros.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Payment processing is not configured.' });
  }

  const {
    package: packageKey,
    stateFormation,
    entityType,
    customerName,
    customerEmail,
    businessName,
    addons,              // array of keys OR object { ao_ra: true, ... }
    addrRA,              // boolean — RA address selected
    addrVirtual,         // boolean — Virtual address selected
    virtualBillingChoice,// 'monthly' | 'annual'
    frontendTotal,       // optional, dollars (number or numeric string)
  } = req.body || {};

  // ---- Validate package -------------------------------------------------
  if (!packageKey || !PACKAGES[packageKey]) {
    return res.status(400).json({ error: 'Invalid package. Must be "essentials" or "complete".' });
  }
  const pkg = PACKAGES[packageKey];

  // ---- Validate state ---------------------------------------------------
  if (!stateFormation || !(stateFormation in STATE_FEES)) {
    return res.status(400).json({ error: `Invalid or missing formation state: "${stateFormation}".` });
  }

  // ---- Validate entity type ---------------------------------------------
  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return res.status(400).json({ error: `Invalid entity type: "${entityType}". Must be LLC, S-Corp, or C-Corp.` });
  }

  // ---- Parse and validate add-ons ---------------------------------------
  let selectedAddonKeys = [];
  if (Array.isArray(addons)) {
    selectedAddonKeys = addons.filter(Boolean);
  } else if (addons && typeof addons === 'object') {
    selectedAddonKeys = Object.keys(addons).filter(k => addons[k]);
  }

  const invalidAddons = selectedAddonKeys.filter(k => !ADDONS[k]);
  if (invalidAddons.length > 0) {
    return res.status(400).json({ error: `Unknown add-on(s): ${invalidAddons.join(', ')}.` });
  }

  // Business Pro add-ons are included — reject if sent as extras
  if (packageKey === 'complete') {
    const bundled = selectedAddonKeys.filter(k => COMPLETE_INCLUDED_ADDONS.has(k));
    if (bundled.length > 0) {
      return res.status(400).json({
        error: `These add-ons are included in Business Pro and cannot be charged separately: ${bundled.join(', ')}.`,
      });
    }
  }

  // ---- Recalculate total (mirrors intake.html submit handler) -----------
  let backendTotal = pkg.basePrice;

  // Add-on prices
  for (const key of selectedAddonKeys) {
    backendTotal += ADDONS[key].price;
  }

  // RA address selection (non-complete only)
  if (addrRA && packageKey !== 'complete') {
    backendTotal += ADDR_RA_PRICE;
  }

  // Virtual address selection
  if (addrVirtual) {
    backendTotal += virtualBillingChoice === 'monthly' ? ADDR_VIRTUAL_MONTHLY : ADDR_VIRTUAL_ANNUAL;
  }

  // State filing fees
  if (packageKey === 'essentials') {
    backendTotal += STATE_FEES[stateFormation];
  } else if (packageKey === 'complete' && stateFormation in PRO_EXCLUDED_FEES) {
    backendTotal += PRO_EXCLUDED_FEES[stateFormation];
  }

  // ---- Compare with frontend total (if provided) ------------------------
  if (frontendTotal !== undefined && frontendTotal !== null && frontendTotal !== '') {
    const parsed = typeof frontendTotal === 'number'
      ? Math.round(frontendTotal)
      : parseInt(String(frontendTotal).replace(/[^0-9]/g, ''), 10);

    if (!isNaN(parsed) && parsed !== backendTotal) {
      return res.status(400).json({
        error: 'Order total mismatch. Please refresh the page and try again.',
        backendTotal,
        frontendTotal: parsed,
      });
    }
  }

  // ---- Build Stripe session metadata ------------------------------------
  const addonNames = selectedAddonKeys.map(k => ADDONS[k].name).join(', ') || 'None';

  const metadata = {
    customer_name:     (customerName  || '').slice(0, 500),
    customer_email:    (customerEmail || '').slice(0, 500),
    business_name:     (businessName  || '').slice(0, 500),
    entity_type:       entityType,
    selected_package:  pkg.label,
    formation_state:   stateFormation,
    selected_addons:   addonNames.slice(0, 500),
    backend_total_usd: String(backendTotal),
  };

  // ---- Create Stripe Checkout session -----------------------------------
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name:        pkg.stripeLabel,
            description: CHECKOUT_DESCRIPTION,
          },
          unit_amount: backendTotal * 100,
        },
        quantity: 1,
      }],
      success_url: 'https://www.bizfilingpros.com/application-received',
      cancel_url:  'https://www.bizfilingpros.com/formation',
      metadata,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[create-checkout-session] Stripe error:', err.message);
    return res.status(500).json({ error: 'Payment session could not be created. Please try again.' });
  }
};
