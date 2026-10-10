# Stripe sandbox verification

Checked 10 October 2026 against Stripe CLI 1.53.1 and API version 2026-09-30.endive.

Stripe's [sandbox documentation](https://docs.stripe.com/sandboxes) supports temporary, anonymous CLI sandboxes without account registration or merchant approval. They process fake payments only. The sandbox created for this verification expires on 17 October 2026 unless claimed. Its keys, claim link, provider logs and fixture database remain in ignored private local artifacts, outside the source offer and Git.

## Verified behavior

An isolated local API used synthetic account fixtures and the actual EdgeLab billing service, Stripe SDK and webhook route.

| Check | Result |
| --- | --- |
| Monthly and yearly price validation | Actual provider prices matched USD 29/month and USD 290/year. |
| Hosted monthly Checkout | Public declined-card fixture displayed an error; retry with the successful test card completed the subscription. |
| Hosted annual Checkout | Successful test card completed the annual subscription. |
| Signed webhook forwarding | Stripe CLI forwarded Checkout completion, subscription creation and paid invoice events; the application processed all six deliveries. |
| Test-mode status | Both subscriptions were active, paid and associated with the correct cadence before cancellation. |
| Paid export gate | The actual subscription dependency rejected both synthetic users with 403; test purchases granted no production workspace/export access. |
| Bad signature | The webhook route returned 400 with no-store and CDN no-store headers. |
| Duplicate receipt | Replaying the provider's original event JSON with a locally generated valid signature returned duplicate=true. This replay signature was generated locally; original deliveries were signed by Stripe. |
| Cancellation | Both disposable test subscriptions were canceled through Stripe; cancellation webhooks updated application records. |

No money moved. Hosted Stripe Checkout, provider integration and the application's billing/webhook/access code were exercised. Google sign-in and the frontend pricing redirect were not an end-to-end browser test here: synthetic users entered Checkout through the billing service, and the callback pointed at the isolated API. Native Google callback and billing identity enforcement have separate automated tests.

## Reproduce locally

Use an isolated database and local origin; never replace live billing secrets with sandbox values. Stripe CLI provisioning requires an email address. Supply an email intentionally; the claim flow can later attach the temporary sandbox to an account.

    rtk proxy stripe --config /private/path/stripe-test.toml sandbox create --email you@example.com --non-interactive
    rtk proxy stripe --config /private/path/stripe-test.toml listen --latest --forward-to http://localhost:8000/api/billing/webhook

Store the CLI output and configuration privately. Set EDGELAB_BILLING_ENABLED=1 and EDGELAB_STRIPE_MODE=test, configure the sandbox secret key, the listener's whsec signing secret, the monthly/yearly recurring price IDs and the local public origin. Keep deployment modes aligned. Restricted rk_test keys and anonymous rkcs keys are supported in test mode; live mode requires a matching sk_live or rk_live key and actual live provider objects. Insufficient key permissions return a sanitized provider error. An unclaimed sandbox key does not support every account-management endpoint.

Use only [Stripe's published test cards](https://docs.stripe.com/testing); never enter a real card into this test workflow. Test purchases intentionally cannot satisfy EdgeLab's live active-subscription requirement for data exports. Live payments still require a merchant account and activation; [India account availability is invite-only](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india?locale=en-GB).
