const stripe = (
  process.env.STRIPE_SECRET_KEY &&
  (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ||
   process.env.STRIPE_SECRET_KEY.startsWith('sk_live_'))
) ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!stripe) {
    return res.status(200).json({ checkoutAvailable: false });
  }

  try {
    const { amount, description } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: description || 'Business Filing Service' },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin || ''}/thank-you.html?payment=paid&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || ''}/intake.html?cancelled=1`,
    });
    return res.status(200).json({ checkoutAvailable: true, url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
