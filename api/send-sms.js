// Vercel Serverless Function to send SMS via Twilio
// This protects your API credentials from being exposed in the browser.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message" in request body' });
  }

  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_NUMBER;

  if (!sid || !token || !from) {
    return res.status(500).json({ error: 'Twilio environment variables are not configured on Vercel.' });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams();
  body.append('To', to);
  body.append('From', from);
  body.append('Body', message);

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body
    });

    const result = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true, sid: result.sid });
    } else {
      return res.status(response.status).json({ success: false, error: result.message });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal Server Error: ' + error.message });
  }
}
