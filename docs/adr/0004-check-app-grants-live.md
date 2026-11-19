# Check app grants live

V1 requires app backends to check current access with IAM for every protected
request. Once a grant revocation commits, the next protected request must deny
access. The app denies the request if IAM cannot complete the check.

This makes IAM an availability dependency for protected app requests. We accept
that dependency to give every customer app the same revocation guarantee.
