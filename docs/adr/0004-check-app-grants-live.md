# Check app grants live

App backends check current access with IAM before each protected request. A committed grant revocation affects the next check. If IAM cannot complete the check, the backend withholds the resource.

This makes IAM an availability dependency for protected requests and gives each installation the same revocation guarantee.
