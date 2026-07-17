# WhatsApp alerts via CallMeBot (optional)

The app can WhatsApp Roel + Nina when a restaurant places an order and when an
order is delivered. Optional and off until configured. Uses CallMeBot
(client-side, free).

Register each recipient's number (do this on each phone — Roel's and Nina's):

1. Add CallMeBot's WhatsApp number to your contacts (get it from
   https://www.callmebot.com/blog/free-api-whatsapp-messages/).
2. Send it exactly: `I allow callmebot to send me messages to my phone`.
3. It replies with your personal **API key** (and confirms your number).

Then configure the app:

4. In `index.html`, fill `CALLMEBOT_RECIPIENTS` with each person's phone in
   E.164 form (e.g. `+3519xxxxxxxx`) and their `apikey`. Commit and push.

Notes:
- Free and rate-limited (a few messages/min) — ample here.
- **Privacy:** the new-order alert is sent from the *restaurant's* browser, so the
  configured phone numbers **and** API keys are visible in the page source to any
  restaurant that logs in. Use numbers you're comfortable sharing with your
  restaurant customers (they likely already have them), or set up a dedicated
  WhatsApp number for this. The delivered alert is sent from your own (admin)
  browser and adds no exposure.
- The API keys sit in the client (like the EmailJS key); worst case someone
  could ping your WhatsApp — rotate the key via CallMeBot if needed.
- Blank a recipient's `phone` or `apikey` to disable them; empty all to turn the
  feature off. Orders/deliveries always work regardless — WhatsApp is a bonus
  alert.
