# IAM owns the OIDC issuer

Customer apps will register with IAM and use its public issuer URL for sign-in. IAM owns the sign-in and token contracts, so customers can build against a stable identity that IAM maintains. The choice of OIDC implementation and the scope of each issuer are separate decisions.
