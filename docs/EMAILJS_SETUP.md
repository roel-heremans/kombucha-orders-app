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
4. **Account → General** → copy your **Public Key**.
5. In `index.html`, fill in `EMAILJS_CONFIG` with the Service ID, Template ID,
   and Public Key. Commit and push.
6. **Important — Account → Security**: turn on the origin allow-list and add
   your site origin `https://roel-heremans.github.io`. This is the key abuse
   control — without it, anyone who finds the public key (it's visible in the
   page source) can use it to send emails through your account from any
   origin, not just your site.

Notes:
- The order always saves and appears in the admin Orders tab even if the email
  fails — email is a best-effort extra alert.
- The free tier caps monthly sends (~200), which is ample here.
- To disable, blank out any of the three values in `EMAILJS_CONFIG`.

## Recibo-upload email (optional)

When an admin uploads a Recibo Verde PDF, the app can email the restaurant with
the recibo details and a pointer to the app's download section. This uses a
**separate template** (reusing the same EmailJS service and public key).

1. In EmailJS, create a new Email Template.
2. Set **To Email** to `{{to_email}}`.
3. Set the **Subject** to: `Novo recibo verde / New recibo — Real Health Kombucha`
4. Set **From Name** to the static text `Real Health Kombucha` (NOT `{{name}}` —
   `{{name}}` is the customer's name, which would make the email look like it came
   from the recipient and hurts deliverability).
5. Set **Reply To** to a real address you monitor (e.g. `roel.heremans@gmail.com`).
6. Set the **Content** to (Portuguese first, then English):

   ```
   Caro(a) {{name}},

   Está disponível um novo recibo verde, acessível a qualquer momento na
   aplicação em https://roel-heremans.github.io/kombucha-orders-app/

   Para o seu arquivo, aceda à secção de download na aplicação e transfira o PDF
   do recibo.

   Detalhes do recibo:
   {{recibo_text}}

   Obrigado pelas suas encomendas anteriores e esperamos que aprecie a nossa Real
   Health Kombucha no futuro.

   Com os melhores cumprimentos,
   Real Health Kombucha

   ─────────────

   Dear {{name}},

   A new recibo verde can be found in the app at any time at
   https://roel-heremans.github.io/kombucha-orders-app/

   To keep it for your records, please go to the download section in the app and
   download the recibo PDF.

   Recibo details:
   {{recibo_text}}

   Thank you for your past orders, and we hope you'll enjoy our Real Health
   Kombucha in the future.

   Best regards,
   Real Health Kombucha
   ```

7. Note the template's **Template ID** and put it in `index.html` as
   `EMAILJS_RECIBO_TEMPLATE`. Leave it empty to keep the feature off.

Only customers who log in with a **real email** receive this. Name-based logins
(`…@kombucha.app`) have no inbox and are skipped — the upload screen tells you to
send those manually. In the admin **Settings → Customers** card, a badge shows
which customers have a real email (green `✉ …`) vs. name logins (`no email`).

### Deliverability (staying out of spam)

Recibo emails go to external mailboxes that may not know the sender yet, so they
can land in spam. Order-notification emails don't have this problem because they
go to your own inbox. To improve inbox placement:

- **From Name** static `Real Health Kombucha` and a real **Reply To** (steps 4–5
  above) — the biggest easy wins.
- Ask each restaurant to mark the first email **"Not spam"** / add the sender to
  contacts once; afterwards their mail lands in the inbox.
- Best long-term: connect a **custom domain** as the EmailJS sending service and
  add **SPF + DKIM + DMARC** DNS records for it.
