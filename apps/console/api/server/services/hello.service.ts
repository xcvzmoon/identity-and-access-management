type Greeting = { message: string };

/**
 * @returns {Greeting} The greeting served by the API's hello endpoint.
 */
export function getGreeting(): Greeting {
  return { message: 'Hello from Nitro!' };
}
