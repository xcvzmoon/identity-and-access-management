# Connect your first private application

In this tutorial, you will register the local reference app, sign in through
IAM, and change the permission that protects its **Read reports** action.

Start [local IAM](local.md#local-setup) with a working SMTP relay and a
disposable organization. Use an existing verified organization owner as
the administrator. An initial organization and owner are provisioning
prerequisites. The public product has no organization creation screen or
route. Use a second verified IAM account as the app user.

1. Open `http://localhost:5173/admin` as the owner. Enroll and verify a
   passkey. The admin page displays the organizations you can manage.
2. Invite the test user's email address. In a separate browser profile,
   sign in as the test user and accept the invitation from **Account**.
   The test user is now a member of the organization.
3. Return to the owner profile. Verify the passkey again if the admin
   window has expired. Select the organization and register the app with
   the callback `https://reports.localhost:8443/callback`. Store the
   client ID and one-time secret in the local app's server environment.
   The app now appears in the admin app list.
4. Add the `reports.read` permission. Create a role named `reader` and
   include that permission. Assign the test user to the app with the
   `reader` role. The member list shows the assignment.
5. Start the [reference client](integrate-app.md#run-the-reference-client)
   with a browser-trusted HTTPS certificate for `reports.localhost`.
   Open `https://reports.localhost:8443` as the test user and choose
   **Sign in with IAM**. Complete IAM sign-in and consent if prompted.
   The browser returns to the reference app.
6. Choose **Read reports**. The request succeeds because IAM introspection
   returns `reports.read` for the user.
7. Remove `reports.read` from the role in IAM. Retry **Read reports**.
   The app returns `403` because the live grant has no matching permission.
8. Revoke the assignment in IAM. Retry **Read reports**. The app returns
   `401` because the grant is inactive.

[Documentation index](README.md) · [Authorization flow](application-access.md) ·
[Administration guide](administer.md)
