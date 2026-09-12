# international-captains@ forwarder

Inbound mail to `international-captains@lansdowne-international-cup.com` is
received by SES, dropped in S3, and forwarded by `index.mjs` to every captain.

## Captains (FORWARD_TO)

Tim Pearce, Vijay Davuluri, Phil Woodisse, Jun Bae, Daren Wickham, Ash,
Ben Hedges, Erik Wagner. The list lives in the Lambda's `FORWARD_TO` env var
as a comma-separated string, so changing the roster needs no code change:

    aws lambda update-function-configuration \
      --function-name icup-captains-forwarder \
      --environment file://env.json \
      --profile icup_website_user --region us-east-1

## How the rewrite works

A forwarded message cannot keep the original `From`. The sender's DKIM
signature does not cover our relay, so their domain's DMARC policy would
reject it. Instead we send as the captains alias, which we sign, and put the
original sender in `Reply-To` so hitting reply still reaches them.

Two things that are easy to get wrong and cost real debugging time:

- **Strip the inbound hop's headers.** Leaving `Feedback-ID`, `X-SES-Outgoing`
  or `X-SES-DKIM-SIGNATURE` on the outbound copy gets it dropped by Gmail with
  no bounce and no SES error. See `STRIP` in `index.mjs`.
- **Keep email addresses out of the display name.** A display name holding an
  address that differs from the one in the angle brackets is the standard
  phishing shape. `displayName()` reduces anything address-shaped to its local
  part.

## Loop protection

Captains receive the forward at the alias they may well reply-all to. Two
guards stop a storm: outbound copies carry `X-LIC-Forwarded`, and anything
arriving with that header or already `From` the alias is dropped.

## AWS resources

| Resource | Name |
| --- | --- |
| Lambda | `icup-captains-forwarder` |
| IAM role | `icup-captains-forwarder-role` |
| S3 bucket | `lansdowne-ic-email-inbound-792782029232` (`inbox/`, 30-day expiry) |
| SES rule | `lansdowne-captains-forward` in rule set `sidebetcaddie-inbound` |
| SES rule | `lansdowne-noreply-accept` in the same rule set |

The rule set is shared with other domains. Add rules to it; never replace it.

### Why `lansdowne-noreply-accept` exists

`icup-submit-availability` sends its RSVP notification with
`noreply@lansdowne-international-cup.com` in `To` and the real recipients in
`Bcc`. That was harmless while the domain had no MX record and mail to
`noreply@` simply went nowhere. Once the MX record was added, every one of
those notifications hit SES inbound, matched no rule, and hard bounced, which
put `noreply@` on the account suppression list.

The rule accepts that mail into S3 and does nothing else, so it stops
bouncing. `icup-submit-availability` has since been fixed to address its
notify list directly, so nothing should route here any more, but the rule is
kept as a safety net.

Any new address on this domain needs a rule before anything sends to it, or it
will bounce the same way.

## DNS

`MX 10 inbound-smtp.us-east-1.amazonaws.com` enables receiving. SPF
(`v=spf1 include:amazonses.com ~all`) and DMARC (`p=none`) were added at the
same time. DMARC is deliberately `p=none` until we have confidence in the
sending sources.

## Testing

Point `FORWARD_TO` at one address before testing so the captains do not get a
test blast, then send to the alias and watch the log:

    aws logs tail /aws/lambda/icup-captains-forwarder --since 5m \
      --profile icup_website_user --region us-east-1
