# Drop the SnapUp customer designs here

The Figma link is behind authentication — fetching it returns the app shell and no design
data — so the design has to reach the repo some other way. Either route below works.

## Option A — screenshots (fastest)

Export each frame from Figma as PNG at **2x** and save them here with the screen name:

```
design/
  01-landing.png
  02-login-phone.png
  03-login-otp.png
  04-home-stores.png
  05-store-entry-qr.png
  06-scan.png
  07-cart.png
  08-checkout-payment.png
  09-payment-upi.png
  10-order-confirmed.png
  11-exit-code.png
  12-account.png
```

In Figma: select the frame → right panel → Export → 2x PNG → Export.
Or select all frames and use **Shift+Ctrl+E** to export them in one go.

Numbering matters only so the order of the flow is obvious. Names can be whatever
matches your file.

## Option B — Figma API token (highest fidelity)

A personal access token lets exact values be read rather than eyeballed from a picture:
hex colours, font families and weights, px spacing, corner radii, and the frame tree.

1. Figma → your avatar → **Settings** → **Security** → *Personal access tokens*
2. Generate one with **File content: read-only**
3. Put it in `apps/customer-web/.env.local` (gitignored):

   ```
   FIGMA_TOKEN=figd_...
   FIGMA_FILE_KEY=kmcp22xFM8pOGDC69Cbc9J
   ```

A read-only token still grants read access to **every file in your account**, so treat it
as a credential: generate it for this, and revoke it in the same Settings page when the
frontend work is done.

## What also helps, in either case

- The **font family** if it is not a Google Font (a licensed font has to be added to the
  repo, and guessing produces a layout that is subtly wrong everywhere).
- Whether the design is **light only, dark only, or both**. The app currently supports
  both, and dropping one is a deletion rather than a restyle.
