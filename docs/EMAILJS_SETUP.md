# EmailJS setup — new-order email alerts (optional)

When a restaurant places an order, the app can email Roel + Nina. This is
optional and off until configured. It uses EmailJS (client-side, free tier).

1. Create a free account at https://www.emailjs.com.
2. **Email Services** → add a service and connect your Gmail. Note the
   **Service ID**.
3. **Email Templates** → create a template. Use these variables in the
   subject/body: `{{restaurant_name}}`, `{{items}}`, `{{preferred_date}}`,
   `{{note}}`, `{{placed_at}}`. Set the template **To** to
   `roel.heremans@gmail.com, reissnina@gmail.com`. Note the **Template ID**.
   Example body:
   > New kombucha order from {{restaurant_name}}
   > Items: {{items}}
   > Preferred date: {{preferred_date}}
   > Note: {{note}}
   > Placed: {{placed_at}}
4. **Account → General/API** → copy your **Public Key**.
5. In `index.html`, fill in `EMAILJS_CONFIG` with the Service ID, Template ID,
   and Public Key. Commit and push.
6. **Account → Security** → turn on the allow-list and add your site origin
   `https://roel-heremans.github.io` so the public key can't be used elsewhere.

Notes:
- The order always saves and appears in the admin Orders tab even if the email
  fails — email is a best-effort extra alert.
- The free tier caps monthly sends (~200), which is ample here.
- To disable, blank out any of the three values in `EMAILJS_CONFIG`.
