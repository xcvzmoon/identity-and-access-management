import * as valibot from 'valibot';

const maximumRedirectLength = 2048;

export const applicationCallbackSchema = valibot.pipe(
  valibot.string(),
  valibot.maxLength(maximumRedirectLength),
  valibot.url(),
  valibot.check((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hostname.includes('*') &&
      !value.includes('#') &&
      url.href === value
    );
  }, 'Use an exact HTTPS callback URL without credentials or a fragment.'),
);
