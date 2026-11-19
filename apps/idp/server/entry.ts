import { isIP } from 'node:net';

const configuredProxies = process.env.IAM_IDP_TRUSTED_PROXIES?.trim();
const trustedProxies = configuredProxies
  ? configuredProxies.split(',').map((address) => address.trim())
  : [];

if (trustedProxies.some((address) => !isIP(address))) {
  throw new Error('IAM_IDP_TRUSTED_PROXIES must contain comma-separated IP addresses.');
}

export default {
  trustProxy: trustedProxies,
};
