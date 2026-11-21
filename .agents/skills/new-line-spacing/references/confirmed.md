# Confirmed spacing patterns

These fictional examples preserve the spacing decisions the owner confirmed.

## A size gate before parsing

The size limit is its own step. Leave a gap after it. Parsing one value and checking the result belong together, even if the error block is longer.

**Good here**

```ts
const exhibit = findExhibit(exhibitId);
const visitor = identifyVisitor(request);

checkNoteLength(request, maximumLength);

const note = await parseGuestbookNote(request);
if (!note.valid) {
  throw new Error('The guestbook note is invalid');
}

await saveNote(exhibit, visitor, note.value);
```

**Bad here**

```ts
const exhibit = findExhibit(exhibitId);
const visitor = identifyVisitor(request);

checkNoteLength(request, maximumLength);
const note = await parseGuestbookNote(request);

if (!note.valid) {
  throw new Error('The guestbook note is invalid');
}

await saveNote(exhibit, visitor, note.value);
```

## A lookup that uses several setup values

The borrower, branch, and lookup form one group. Let the reader finish that setup before handling the result. Moving the gap above the lookup breaks the group and crowds the error check.

**Good here**

```ts
const borrower = identifyBorrower(request);
const branch = findBranch(branchCode);
const reservation = await catalog.read((reader) => reader.findHold(borrower, branch));

if (reservation.isErr()) {
  return catalogUnavailable();
}
```

**Bad here**

```ts
const borrower = identifyBorrower(request);
const branch = findBranch(branchCode);

const reservation = await catalog.read((reader) => reader.findHold(borrower, branch));
if (reservation.isErr()) {
  return catalogUnavailable();
}
```

## A direct operation and its check

Here the inputs are already prepared. The call and its immediate failure check form a compact action. The no-seats outcome is a separate decision.

**Good here**

```ts
const booking = await reserveSeats(show, guest, seats);
if (booking.isErr()) {
  return bookingFailed();
}

if (booking.value.status === 'sold-out') {
  return offerWaitlist();
}
```

**Bad here**

```ts
const booking = await reserveSeats(show, guest, seats);

if (booking.isErr()) {
  return bookingFailed();
}

if (booking.value.status === 'sold-out') {
  return offerWaitlist();
}
```

Both the reservation lookup and the booking call are awaited declarations followed by `isErr()`. What the reader has just taken in explains the different spacing.

## Handing off or releasing a resource

Taking a callback and checking for it reads as one action. The fallback starts after the gap.

**Good here**

```ts
function releaseStudio(): void {
  const nextVisitor = studioWaitlist.shift();
  if (nextVisitor) {
    nextVisitor();
    return;
  }

  occupiedStudios--;
}
```

**Bad here**

```ts
function releaseStudio(): void {
  const nextVisitor = studioWaitlist.shift();

  if (nextVisitor) {
    nextVisitor();
    return;
  }

  occupiedStudios--;
}
```

Creating, registering, and awaiting a promise is one sequence. A gap before the await interrupts it.

**Good here**

```ts
const { promise: entry, resolve: admit } = Promise.withResolvers<undefined>();
studioWaitlist.push(() => admit(undefined));
await entry;
```

**Bad here**

```ts
const { promise: entry, resolve: admit } = Promise.withResolvers<undefined>();
studioWaitlist.push(() => admit(undefined));

await entry;
```
