import { useAuth } from '@iam/auth';
import { HTTPError, defineHandler } from 'nitro';
import { setOidcHeaders } from '../utils/auth-http.ts';

const confidentialAuthMethods = ['client_secret_basic', 'client_secret_post'];
const idTokenClaims = ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'auth_time'];

export default defineHandler(async (event) => {
  setOidcHeaders(event);

  const provider = await useAuth().api.getOpenIdConfig();
  if (provider.issuer !== event.url.origin) {
    throw new HTTPError('OpenID Connect is unavailable on this origin', { status: 503 });
  }

  return {
    issuer: provider.issuer,
    authorization_endpoint: provider.authorization_endpoint,
    token_endpoint: provider.token_endpoint,
    userinfo_endpoint: provider.userinfo_endpoint,
    introspection_endpoint: provider.introspection_endpoint,
    revocation_endpoint: provider.revocation_endpoint,
    jwks_uri: provider.jwks_uri,
    claims_supported: idTokenClaims,
    scopes_supported: provider.scopes_supported,
    response_types_supported: provider.response_types_supported,
    response_modes_supported: provider.response_modes_supported,
    grant_types_supported: provider.grant_types_supported,
    subject_types_supported: provider.subject_types_supported,
    id_token_signing_alg_values_supported: provider.id_token_signing_alg_values_supported,
    code_challenge_methods_supported: provider.code_challenge_methods_supported,
    authorization_response_iss_parameter_supported:
      provider.authorization_response_iss_parameter_supported,
    token_endpoint_auth_methods_supported: confidentialAuthMethods,
    introspection_endpoint_auth_methods_supported: confidentialAuthMethods,
    revocation_endpoint_auth_methods_supported: confidentialAuthMethods,
  };
});
