# Spacing around file and data structure

Use the surrounding file's conventions. This skill concerns **blank lines** between code groups. Ordinary line breaks inside an expression are the formatter's job.

## Imports, declarations, and exports

**Keep an import group compact.** Use the project's import ordering and keep the imports used by one module together. A gap between imports and module declarations makes the change of level visible.

**Good here**

```ts
import type { BookingScope } from './types.ts';
import { useDatabase } from './database.ts';

const maximumMatches = 10;
```

**Bad here**

```ts
import type { BookingScope } from './types.ts';

import { useDatabase } from './database.ts';
const maximumMatches = 10;
```

**Give adjacent substantial functions space.** Keep overload signatures attached to their implementation. Keep a JSDoc block attached to the declaration it describes.

**Good here**

```ts
/** Uses the supplied scope for the lookup. */
export function findWorkshop(scope: BookingScope): Promise<Workshop> {
  return loadWorkshop(scope);
}

export function countSeats(workshop: Workshop): number {
  return workshop.seats.length;
}
```

**Bad here**

```ts
/** Uses the supplied scope for the lookup. */

export function findWorkshop(scope: BookingScope): Promise<Workshop> {
  return loadWorkshop(scope);
}
export function countSeats(workshop: Workshop): number {
  return workshop.seats.length;
}
```

**Keep a short group of re-exports together.** Split larger export groups only when the boundary actually helps readers find something.

**Good here**

```ts
export { seats } from './seats.ts';
export { studios } from './studios.ts';
export { workshops } from './workshops.ts';
```

**Bad here**

```ts
export { seats } from './seats.ts';

export { studios } from './studios.ts';

export { workshops } from './workshops.ts';
```

**Keep related aliases or discriminated variants together.** Separate type families when they represent different parts of the module.

**Good here**

```ts
type WorkshopId = string;
type EntryId = string;

type ReviewAction =
  | { kind: 'pending' }
  | { kind: 'strict'; entryId: EntryId };
```

**Bad here**

```ts
type WorkshopId = string;

type EntryId = string;
type ReviewAction =
  | { kind: 'pending' }
  | { kind: 'strict'; entryId: EntryId };
```

**Within a class or long object, group by responsibility.** Keep fields that describe the same state together. Let a substantial member end before opening the next operation.

**Good here**

```ts
class PollState {
  running = false;
  retryAfter = 0;

  defer(now: number): void {
    this.running = false;
    this.retryAfter = now + 1_000;
  }

  isDue(now: number): boolean {
    return !this.running && now >= this.retryAfter;
  }
}
```

**Bad here**

```ts
class PollState {
  running = false;

  retryAfter = 0;
  defer(now: number): void {
    this.running = false;

    this.retryAfter = now + 1_000;
  }
  isDue(now: number): boolean {
    return !this.running && now >= this.retryAfter;
  }
}
```

## Multiline expressions and data

**Keep a method chain visually continuous.** Use a blank line after a completed query if its result leads into a substantial next step. Avoid blank lines between chained `.select()`, `.from()`, and `.where()` calls. The same applies to a promise chain, a Valibot pipeline, and nested argument lists.

**Keep a small record or schema together.**

**Good here**

```ts
const input = v.object({
  workshopId: idSchema,
  entryId: idSchema,
  action: actionSchema,
});
```

**Bad here**

```ts
const input = v.object({
  workshopId: idSchema,

  entryId: idSchema,

  action: actionSchema,
});
```

**A long data declaration can carry real groups.** Follow existing local grouping for columns, options, or rules. Leave a blank between separate table declarations. In a small table, gaps between every column make the keys harder to scan.

**Good here**

```ts
const rooms = pgTable('rooms', {
  id: uuid().primaryKey(),
  name: text().notNull(),
});

const seats = pgTable('seats', {
  id: uuid().primaryKey(),
  roomId: uuid().notNull(),
});
```

**Bad here**

```ts
const rooms = pgTable('rooms', {
  id: uuid().primaryKey(),

  name: text().notNull(),
});
const seats = pgTable('seats', {
  id: uuid().primaryKey(),
  roomId: uuid().notNull(),
});
```

**Keep array items together.** The array is one list. Let the formatter wrap longer items, and keep any item comment attached to the item it describes.

**Good here**

```ts
const checks = [
  checkTicket,
  checkRoomCapacity,
  checkProjector,
  checkMicrophone,
];
```

**Bad here**

```ts
const checks = [
  checkTicket,
  checkRoomCapacity,

  checkProjector,
  checkMicrophone,
];
```

**Preserve literal content.** A blank line inside a template string, regex fixture, SQL snapshot, or expected output can change behavior. A spacing-only request does not authorize changing it. Also preserve directives and comments attached to the next line.

**Good here**

```ts
const expected = `Door opens at nine.

Please bring a ticket.`;

expect(printSign()).toBe(expected);
```

**Bad here**

```ts
const expected = `Door opens at nine.
Please bring a ticket.`;
expect(printSign()).toBe(expected);
```

## Tests

**Keep a two-line test together.**

**Good here**

```ts
it('rejects an empty ID', () => {
  const result = parseId('');
  expect(result.success).toBe(false);
});
```

**Bad here**

```ts
it('rejects an empty ID', () => {
  const result = parseId('');

  expect(result.success).toBe(false);
});
```

**Keep all four declarations together.** The input, guest, first reservation, and replay form one short sequence. Leave one blank line before the assertions.

**Good here**

```ts
it('reuses a reservation on retry', async () => {
  const input = createReservationInput();
  const guest = await registerGuest(input);
  const first = await reserveSeat(guest, input);
  const replay = await reserveSeat(guest, input);

  expect(replay.reservationId).toBe(first.reservationId);
  expect(await countReservations(guest)).toBe(1);
});
```

**Bad here**

```ts
it('reuses a reservation on retry', async () => {
  const input = createReservationInput();
  const guest = await registerGuest(input);
  const first = await reserveSeat(guest, input);

  const replay = await reserveSeat(guest, input);

  expect(replay.reservationId).toBe(first.reservationId);
  expect(await countReservations(guest)).toBe(1);
});
```

**Keep related assertions together.** Add a gap when switching to a different artifact or exercising a second phase, such as checking the HTTP response and then opening the saved object. Keep test hooks and test cases in readable groups at file scope.

## Cursor and scope checks

When reviewing a diff, inspect some lines before and after each changed block. A gap near a patch boundary can belong to the following group or the preceding group. Preserve sensible surrounding spacing. For a spacing-only edit, check that removing blank lines from both versions produces identical text and verify that literals and directives are unaffected.

## Good and bad layouts for the same code

### A chain reads as one query

**Good here**

```ts
const seats = await catalog
  .select()
  .from(seating)
  .where(eq(seating.room, room));
```

**Bad here**

```ts
const seats = await catalog
  .select()

  .from(seating)

  .where(eq(seating.room, room));
```

The gaps suggest that the clauses are independent actions. They belong to the same query.

### A test crosses from the response to a persisted artifact

**Good here**

```ts
expect(ticket.status).toBe('confirmed');
expect(ticket.guest).toBe(guest);

const saved = await readTicket(ticket.id);
expect(saved.room).toBe(room);
```

**Bad here**

```ts
expect(ticket.status).toBe('confirmed');

expect(ticket.guest).toBe(guest);
const saved = await readTicket(ticket.id);
expect(saved.room).toBe(room);
```

The gap separates two assertions about the response and leaves the switch to the persisted artifact unmarked.

## JSDoc and comments

### Keep JSDoc attached to the declaration

When code precedes a function with JSDoc or a leading comment, leave a blank line before the comment. Keep the comment directly above the function.

**Good here**

```ts
const defaultStudioHours = 2;

/** Finds the earliest studio opening on the requested day. */
function findOpening(day: Date): Opening | undefined {
  return openings.find((opening) => isSameDay(opening.day, day));
}
```

**Bad here**

```ts
const defaultStudioHours = 2;
/** Finds the earliest studio opening on the requested day. */

function findOpening(day: Date): Opening | undefined {
  return openings.find((opening) => isSameDay(opening.day, day));
}
```

### A regular comment above a function

Use the same spacing when the function starts with a regular comment.

**Good here**

```ts
const studioOpenHour = 9;

// Early arrivals can wait in the lobby.
function canEnterStudio(hour: number): boolean {
  return hour >= studioOpenHour;
}
```

**Bad here**

```ts
const studioOpenHour = 9;
// Early arrivals can wait in the lobby.

function canEnterStudio(hour: number): boolean {
  return hour >= studioOpenHour;
}
```

### Keep consecutive JSDoc tags together

A blank JSDoc line separates the description from the tags. The tags form one group.

**Good here**

```ts
/**
 * Reserves a studio until the end of the current session.
 *
 * @param studio - The studio to reserve.
 * @param visitor - The visitor making the reservation.
 * @returns The reservation, or undefined if the studio is occupied.
 */
function reserveStudio(studio: Studio, visitor: Visitor): Reservation | undefined {
  return studio.reserve(visitor);
}
```

**Bad here**

```ts
/**
 * Reserves a studio until the end of the current session.
 * @param studio - The studio to reserve.
 *
 * @param visitor - The visitor making the reservation.
 *
 * @returns The reservation, or undefined if the studio is occupied.
 */
function reserveStudio(studio: Studio, visitor: Visitor): Reservation | undefined {
  return studio.reserve(visitor);
}
```

### Keep a short explanation with the action it explains

The comment explains the use of the original price, so it stays with the calculation. Code in this repository still follows its policy on when to add comments.

**Good here**

```ts
const ticket = findTicket(ticketId);
// Refunds use the original purchase price.
const refund = calculateRefund(ticket.originalPrice);
return refund;
```

**Bad here**

```ts
const ticket = findTicket(ticketId);
// Refunds use the original purchase price.

const refund = calculateRefund(ticket.originalPrice);
return refund;
```

### Put a gap before a comment that opens a new step

The first two calls prepare the sale. The comment belongs to the step that records it.

**Good here**

```ts
reserveSeats(seats);
applyDiscount(discount);

// Record the sale only after the price is settled.
recordSale(sale);
```

**Bad here**

```ts
reserveSeats(seats);
applyDiscount(discount);
// Record the sale only after the price is settled.

recordSale(sale);
```
