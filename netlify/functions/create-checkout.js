const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amountCents, packageLabel, customerEmail, customerName, metadata } = JSON.parse(event.body);

    if (!amountCents || amountCents < 100) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const siteUrl = process.env.URL || 'https://bizfilingpros.com';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(amountCents),
          product_data: {
            name: packageLabel,
            description: `Business filing services — ${metadata.state || 'All states'}`
          }
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${siteUrl}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/intake.html`,
      metadata: {
        customer_name: customerName || '',
        package: metadata.package || '',
        state: metadata.state || '',
        addons: (metadata.addons || '').substring(0, 500),
        coupon: metadata.coupon || 'none',
        total: metadata.total || ''
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
