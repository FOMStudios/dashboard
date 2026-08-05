/* =====================================================================
   FOM STUDIOS — payment settings
   ---------------------------------------------------------------------
   Set these ONCE. This file is NOT overwritten when the calculator
   (index.html) is updated, so your Worker URL stays put.

   Paste your Cloudflare Worker URL between the quotes to switch on the
   Yoco "Pay Deposit / Pay Full" buttons on the invoice. Leave it blank
   to show EFT-only (no card buttons).
   ===================================================================== */
var PAY_WORKER_URL  = "https://fom-yoco.cold-moon-d65c.workers.dev/";   // e.g. "https://fom-yoco.yourname.workers.dev"
var PAY_DEPOSIT_PCT = 50;   // default deposit %
