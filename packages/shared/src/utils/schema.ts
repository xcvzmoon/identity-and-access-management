import * as valibot from 'valibot';

/** Parses the strings `true` and `false` as booleans, defaulting missing values to false. */
export const booleanSchema = valibot.pipe(
  valibot.optional(valibot.picklist(['true', 'false']), 'false'),
  valibot.transform((value) => value === 'true'),
);
