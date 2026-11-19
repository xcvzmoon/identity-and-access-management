# Verify or recover an account

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md)

## Email verification

Enter your name and email on the signup page, then request a code and set
your password. IAM creates a session only after you verify your email and
sign in. If you already registered but have yet to verify your email, use
the same email code flow. Configure the API's SMTP relay to deliver codes.
[SMTP configuration](http-api.md#configuration)

## Password recovery

Use **Verify your email or reset your password** on either IAM sign-in page.
Active accounts with a password can receive an eight-digit code.
The page shows the same request confirmation for every valid email address.
The code expires after five minutes, and each account can receive one code
per five-minute window. After resetting a password, sign in again. IAM
revokes existing sessions, including sessions that passed the admin passkey
check. Entering the code does not sign you in. If you started from a registered
app, return there to restart sign-in. Recovery uses the same SMTP relay as
email verification.
