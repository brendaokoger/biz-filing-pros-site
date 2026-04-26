'use strict';

// ---------------------------------------------------------------------------
// Pricing tables — must stay in sync with intake.html frontend values
// ---------------------------------------------------------------------------

const PACKAGES = {
  essentials: {
    label:       'Business Starter Package',
    stripeLabel: 'Biz Filing Pros Business Starter Package',
    basePrice:   249,   // user spec; frontend currently shows 275 — see NOTE below
    includesStateFee: false,
  },
  complete: {
    label:       'Business Pro Package',
    stripeLabel: 'Biz Filing Pros Business Pro Package',
    basePrice:   1549,
    includesStateFee: true, // except for PRO_EXCLUDED_STATES
  },
};

// State filing fees (full state names, dollars)
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

// Business Pro states where the filing fee is NOT included in $1,549
const PRO_EXCLUDED_STATES = new Set([
  'California', 'Nevada', 'Texas', 'Tennessee', 'Massachusetts',
  'Alaska', 'Maryland', 'Maine', 'Washington', 'Washington D.C.',
]);

// Valid add-ons — prices per user spec
// ao_statetm: spec says $249; frontend currently uses $250 — see NOTE below
// ao_web: spec says $749; frontend label exists but no active toggle yet — see NOTE below
const ADDONS = {
  ao_expedited: { name: 'Expedited Filing',                              price: 149  },
  ao_ra:        { name: 'Registered Agent (1 Year)',                     price: 149  },
  ao_oa_sm:     { name: 'Operating Agreement — Single Member',      price: 99   },
  ao_oa:        { name: 'Operating Agreement / Bylaws — Multi-Member or Corp', price: 149 },
  ao_statetm:   { name: 'State Trademark (1 Class)',                     price: 249  },
  ao_fedtm:     { name: 'Federal Trademark (1 Class)',                   price: 1099 },
  ao_email:     { name: 'Business Email Setup',                          price: 149  },
  ao_web:       { name: 'Launch Site (One-Page Website)',                price: 749  },
  ao_duns:      { name: 'DUNS Number Registration',                      price: 49   },
};

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

  // ---- Parse body -------------------------------------------------------
  const {
    package: packageKey,
    stateFormation,
    entityType,
    customerName,
    customerEmail,
    businessName,
    addons,        // array of keys OR object {ao_ra: true, ...}
    frontendTotal, // optional dollar amount (number or numeric string) from frontend
  } = req.body || {};

  // ---- Validate package -------------------------------------------------
  if (!packageKey || !PACKAGES[packageKey]) {
    return res.status(400).json({ error: 'Invalid package selected. Must be "essentials" or "complete".' });
  }
  const pkg = PACKAGES[packageKey];

  // ---- Validate state ---------------------------------------------------
  if (!stateFormation || !(stateFormation in STATE_FEES)) {
    return res.status(400).json({ error: `Invalid or missing formation state: "${stateFormation}".` });
  }
  const stateFee = STATE_FEES[stateFormation];

  // ---- Validate entity type ---------------------------------------------
  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return res.status(400).json({ error: `Invalid entity type: "${entityType}". Must be LLC, S-Corp, or C-Corp.` });
  }

  // ---- Validate add-ons -------------------------------------------------
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

  // ---- Calculate backend total ------------------------------------------
  let backendTotal = pkg.basePrice;

  if (packageKey === 'essentials') {
    backendTotal += stateFee;
  } else if (packageKey === 'complete' && PRO_EXCLUDED_STATES.has(stateFormation)) {
    backendTotal += stateFee;
  }

  for (const key of selectedAddonKeys) {
    backendTotal += ADDONS[key].price;
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

  // ---- Build metadata ---------------------------------------------------
  const addonNames = selectedAddonKeys.map(k => ADDONS[k].name).join(', ') || 'None';

  const metadata = {
    customer_name:    (customerName  || '').slice(0, 500),
    customer_email:   (customerEmail || '').slice(0, 500),
    business_name:    (businessName  || '').slice(0, 500),
    entity_type:      entityType,
    selected_package: pkg.label,
    formation_state:  stateFormation,
    selected_addons:  addonNames.slice(0, 500),
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
          unit_amount: backendTotal * 100, // Stripe expects cents
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
