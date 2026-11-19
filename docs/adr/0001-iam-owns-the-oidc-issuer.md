# IAM owns the OIDC issuer

Customer applications register with IAM and use its public issuer URL for sign-in. IAM owns the hosted sign-in and token contracts. Keeping the issuer under IAM control gives relying parties a stable identity and lets IAM change its implementation within those contracts.
