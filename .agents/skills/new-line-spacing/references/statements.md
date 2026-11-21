# Spacing inside functions

These are examples, not templates to impose. In each pair, notice what changed for the reader.

## Declarations and conditions

**Together: one read and one simple check.**

**Good here**

```ts
const file = files.at(-1);
if (!file) {
  return null;
}
```

**Bad here**

```ts
const file = files.at(-1);

if (!file) {
  return null;
}
```

**Separate: several values lead into a joint decision.** Keep the declarations as one group.

**Good here**

```ts
const file = files.at(-1);
const owner = readOwner(session);
const canReview = checkRole(owner, file);

if (!file || !canReview) {
  return null;
}
```

**Bad here**

```ts
const file = files.at(-1);
const owner = readOwner(session);

const canReview = checkRole(owner, file);
if (!file || !canReview) {
  return null;
}
```

**Together: one parse, even if its failure response spans multiple lines.**

**Good here**

```ts
const result = v.safeParse(schema, input);
if (!result.success) {
  throw new HTTPError({
    status: 422,
    message: 'Invalid guestbook note',
  });
}
```

**Bad here**

```ts
const result = v.safeParse(schema, input);

if (!result.success) {
  throw new HTTPError({
    status: 422,
    message: 'Invalid guestbook note',
  });
}
```

### A lookup with an expanded argument list

**Good here**

```ts
const file = await findWorkshopEntry(
  caller,
  sessionId,
  entryId,
);

if (!file) {
  return notFound();
}
```

**Bad here**

```ts
const file = await findWorkshopEntry(
  caller,
  sessionId,
  entryId,
);
if (!file) {
  return notFound();
}
```

The expanded arguments are part of the lookup. The gap after the closing parenthesis gives that lookup a clear end before the guard begins.

**Separate: the reader has to follow a query's projection, source, and filters before handling its result.**

**Good here**

```ts
const [job] = await database
  .select()
  .from(jobs)
  .where(eq(jobs.id, jobId))
  .limit(1);

if (!job) {
  return null;
}
```

**Bad here**

```ts
const [job] = await database
  .select()
  .from(jobs)
  .where(eq(jobs.id, jobId))
  .limit(1);
if (!job) {
  return null;
}
```

**Separate the phases: a syntax check and a subsequent access decision.**

**Good here**

```ts
const parsed = parseToken(token);
if (!parsed.success) {
  return unauthorized();
}

const access = await findAccess(parsed.output);
if (!access) {
  return forbidden();
}
```

**Bad here**

```ts
const parsed = parseToken(token);
if (!parsed.success) {
  return unauthorized();
}
const access = await findAccess(parsed.output);

if (!access) {
  return forbidden();
}
```

These small groups can each keep the guard close. In a longer handler, a setup group and a more involved result check may benefit from a gap, as in [the reservation lookup](confirmed.md#a-lookup-that-uses-several-setup-values).

## Consecutive declarations

**Together: each declaration prepares the same next step.**

**Good here**

```ts
const route = getRoute(event);
const session = await getSession(event);
const result = await authorize(route, session);

if (!result.allowed) {
  return forbidden();
}
```

**Bad here**

```ts
const route = getRoute(event);
const session = await getSession(event);

const result = await authorize(route, session);
if (!result.allowed) {
  return forbidden();
}
```

**Keep extraction and the input built from it together.** The second declaration just packages the result for comparison.

**Good here**

```ts
const extracted = await extractFile(bytes, {
  maxBytes,
  includeMetadata: true,
});
const comparisonInput = {
  name: file.name,
  metadata: extracted.metadata,
  text: extracted.text,
};
```

**Bad here**

```ts
const extracted = await extractFile(bytes, {
  maxBytes,
  includeMetadata: true,
});

const comparisonInput = {
  name: file.name,
  metadata: extracted.metadata,
  text: extracted.text,
};
```

**Keep a short mixed-name pair together if both values serve the same purpose.**

**Good here**

```ts
const MAX_BYTES = 1024;
const allowedBytes = Math.min(config.maxBytes, MAX_BYTES);
```

**Bad here**

```ts
const MAX_BYTES = 1024;

const allowedBytes = Math.min(config.maxBytes, MAX_BYTES);
```

**Separate configuration from state when both groups have a distinct role.**

**Good here**

```ts
const MAX_ACTIVE = 2;
const MAX_WAITING = 8;

let active = 0;
const waiting: (() => void)[] = [];
```

**Bad here**

```ts
const MAX_ACTIVE = 2;

const MAX_WAITING = 8;
let active = 0;
const waiting: (() => void)[] = [];
```

## Calls, writes, and assignments

**Together: a declaration and a call complete a tiny operation.**

**Good here**

```ts
const key = makeCatalogKey(book.isbn);
cache.delete(key);
```

**Bad here**

```ts
const key = makeCatalogKey(book.isbn);

cache.delete(key);
```

**Separate: bounding the request is its own step before parsing.**

**Good here**

```ts
checkNoteLength(request, maximumLength);

const body = await parseGuestbookNote(request);
if (!body.success) {
  return invalidBody();
}
```

**Bad here**

```ts
checkNoteLength(request, maximumLength);
const body = await parseGuestbookNote(request);

if (!body.success) {
  return invalidBody();
}
```

**Together: several calls all prepare the same request.**

**Good here**

```ts
headers.delete('authorization');
headers.delete('content-length');
headers.set('cache-control', 'no-store');
```

**Bad here**

```ts
headers.delete('authorization');

headers.delete('content-length');
headers.set('cache-control', 'no-store');
```

**Keep a short sequence of writes together.** The original, preview, and document record are parts of the same save.

**Good here**

```ts
await storeOriginal(key, bytes);
await storePreview(previewKey, previewBytes);
await writeDocumentRecord(record);
```

**Bad here**

```ts
await storeOriginal(key, bytes);
await storePreview(previewKey, previewBytes);

await writeDocumentRecord(record);
```

**Together: a small mutation and its stop condition.**

**Good here**

```ts
attempt++;
if (attempt >= limit) {
  return exhausted();
}
```

**Bad here**

```ts
attempt++;

if (attempt >= limit) {
  return exhausted();
}
```

**Keep the values and the update that uses them together.** The declarations supply the fields for this single write.

**Good here**

```ts
const token = createLeaseToken();
const attempts = job.attempts + 1;
await database.update(jobs).set({ token, attempts }).where(eq(jobs.id, job.id));
```

**Bad here**

```ts
const token = createLeaseToken();
const attempts = job.attempts + 1;

await database.update(jobs).set({ token, attempts }).where(eq(jobs.id, job.id));
```

**Together: a cursor update and the concrete page it advances past.**

**Good here**

```ts
after = last.id;
yield rows;
```

**Bad here**

```ts
after = last.id;

yield rows;
```

**Separate: a mutation starts after a validation or setup phase.**

**Good here**

```ts
const decision = validateReview(input);
if (!decision.ok) {
  return decision;
}

review.state = 'approved';
review.updatedAt = now;
```

**Bad here**

```ts
const decision = validateReview(input);
if (!decision.ok) {
  return decision;
}
review.state = 'approved';

review.updatedAt = now;
```

## Returns, throws, awaits, and control flow

**Together: the return completes a tiny computation.**

**Good here**

```ts
const count = rows.length;
return count > 0;
```

**Bad here**

```ts
const count = rows.length;

return count > 0;
```

**Together: status and response describe the same outcome.**

**Good here**

```ts
event.res.status = 202;
return { sessionId };
```

**Bad here**

```ts
event.res.status = 202;

return { sessionId };
```

**Separate: finish a substantial call before deriving the return value.**

**Good here**

```ts
const rows = await database
  .select()
  .from(files)
  .where(eq(files.sessionId, sessionId));

return rows.map(toSummary);
```

**Bad here**

```ts
const rows = await database
  .select()
  .from(files)
  .where(eq(files.sessionId, sessionId));
return rows.map(toSummary);
```

**Together: a deliberately small branch or cleanup callback.**

**Good here**

```ts
if (next) {
  next();
  return;
}

return async () => {
  clearInterval(timer);
  await running;
};
```

**Bad here**

```ts
if (next) {
  next();

  return;
}

return async () => {
  clearInterval(timer);

  await running;
};
```

**Separate: successive guards recover from different conditions.** The gap is between the guards, not necessarily between a short declaration and its first guard.

**Good here**

```ts
if (result.isErr()) {
  return unavailable();
}

if (!result.value) {
  return notFound();
}
```

**Bad here**

```ts
if (result.isErr()) {
  return unavailable();
}
if (!result.value) {
  return notFound();
}
```

**Keep alternatives in one block.** Do not put a blank between a closing brace and its `else`, `catch`, or `finally`. Within a longer branch, use normal grouping.

**Good here**

```ts
try {
  await writeObject(key, bytes);
} catch {
  return failed();
} finally {
  releaseReservation();
}
```

**Bad here**

```ts
try {
  await writeObject(key, bytes);

} catch {
  return failed();

} finally {
  releaseReservation();
}
```

### Code before a try block

Leave a blank line before `try` when code precedes it in the same block. Keep `catch` attached to the closing brace of `try`.

**Good here**

```ts
const reservation = prepareReservation(guest);

try {
  return await saveReservation(reservation);
} catch {
  return reservationUnavailable();
}
```

**Bad here**

```ts
const reservation = prepareReservation(guest);
try {
  return await saveReservation(reservation);
} catch {
  return reservationUnavailable();
}
```

### A loop that is the whole function

The initialization, loop, and return make up the entire body. The compact version reads as one operation.

**Good here**

```ts
function countBytes(files: readonly File[]): number {
  let count = 0;
  for (const file of files) {
    count += file.size;
  }
  return count;
}
```

**Bad here**

```ts
function countBytes(files: readonly File[]): number {
  let count = 0;

  for (const file of files) {
    count += file.size;
  }

  return count;
}
```

### The same loop in a larger function

When the function also loads and filters entries, give the loop its own group. Keep the setup declarations together and leave a gap before the return.

**Good here**

```ts
function countReadableBytes(folder: Folder): number {
  const entries = readEntries(folder);
  const files = entries.filter(isReadableFile);
  let count = 0;

  for (const file of files) {
    count += file.size;
  }

  return count;
}
```

**Bad here**

```ts
function countReadableBytes(folder: Folder): number {
  const entries = readEntries(folder);
  const files = entries.filter(isReadableFile);
  let count = 0;
  for (const file of files) {
    count += file.size;
  }
  return count;
}
```

**Separate: setup, substantial loop, and result each have a role.**

**Good here**

```ts
const results: FileResult[] = [];
const deadline = calculateDeadline();

for (const file of files) {
  if (expired(deadline)) {
    break;
  }

  const result = await extract(file);
  results.push(result);
}

return summarize(results);
```

**Bad here**

```ts
const results: FileResult[] = [];
const deadline = calculateDeadline();
for (const file of files) {
  if (expired(deadline)) {
    break;
  }

  const result = await extract(file);

  results.push(result);
}
return summarize(results);
```

**Together: short switch cases are easy to scan. Add space within or between substantial cases if their bodies become difficult to follow.**

**Good here**

```ts
switch (state) {
  case 'ready':
    return readyResponse();
  case 'missing':
    return notFound();
}
```

**Bad here**

```ts
switch (state) {
  case 'ready':
    return readyResponse();

  case 'missing':
    return notFound();
}
```

**Separate: a mode switch after preparation needs a visible transition.**

**Good here**

```ts
const scope = await loadScope(event);
const mode = resolveMode(scope, event.url);

switch (mode) {
  case 'strict':
    return compareStrict(scope);
  case 'metadata':
    return compareMetadata(scope);
}
```

**Bad here**

```ts
const scope = await loadScope(event);
const mode = resolveMode(scope, event.url);
switch (mode) {
  case 'strict':
    return compareStrict(scope);
  case 'metadata':
    return compareMetadata(scope);
}
```

**Make the rule visible before the branch if several checks must agree.** Keep the preparation together, then give the decision its own group.

**Good here**

```ts
const expired = job.deadlineAt <= now;
const hasLease = job.leaseToken === token;
const canFinish = !expired && hasLease;

if (!canFinish) {
  return conflict();
}
```

**Bad here**

```ts
const expired = job.deadlineAt <= now;
const hasLease = job.leaseToken === token;

const canFinish = !expired && hasLease;
if (!canFinish) {
  return conflict();
}
```

**Keep a short fallback branch attached, then pause before returning to the main flow.**

**Good here**

```ts
if (text) {
  indexText(text);
} else {
  markUnavailable(entryId);
}

await saveProgress(entryId);
```

**Bad here**

```ts
if (text) {
  indexText(text);

} else {
  markUnavailable(entryId);
}
await saveProgress(entryId);
```

## Mixed and nested code

**Keep a callback's related steps close.** Mentally read it independently of its caller.

**Good here**

```ts
return files.map((file) => {
  const summary = toSummary(file);
  return { ...summary, state: file.state };
});
```

**Bad here**

```ts
return files.map((file) => {
  const summary = toSummary(file);

  return { ...summary, state: file.state };
});
```

**Keep preparing and awaiting a small group of tasks together.** The callback wraps across several lines, but the wait completes that operation.

**Good here**

```ts
const tasks = files.map((file) => {
  const key = buildKey(file.id);
  return queueFile(file, key);
});
await Promise.all(tasks);
```

**Bad here**

```ts
const tasks = files.map((file) => {
  const key = buildKey(file.id);
  return queueFile(file, key);
});

await Promise.all(tasks);
```

**Keep the writes that complete one transaction together.** These rows are all part of the same save.

**Good here**

```ts
await transaction.insert(documents).values(document);
await transaction.insert(versions).values(version);
await transaction.insert(announcements).values(receipt);
```

**Bad here**

```ts
await transaction.insert(documents).values(document);
await transaction.insert(versions).values(version);

await transaction.insert(announcements).values(receipt);
```

**Keep comments with their statements.** Fetching the next page uses the index immediately. Leave the directive attached to the statement it controls.

**Good here**

```ts
const index = nextPage();
// oxlint-disable-next-line eslint/no-await-in-loop
const page = await fetchPage(index);
```

**Bad here**

```ts
const index = nextPage();
// oxlint-disable-next-line eslint/no-await-in-loop

const page = await fetchPage(index);
```

## Good and bad layouts for the same code

These comparisons show what the blank line changes. The worse layout is harder to read in that block. Its shape might fit a different block.

### Several declarations feed one decision

**Good here**

```ts
const room = findRoom(roomCode);
const guest = readGuest(ticket);
const permitted = canEnter(room, guest);

if (!permitted) {
  return inviteToLobby();
}
```

**Bad here**

```ts
const room = findRoom(roomCode);
const guest = readGuest(ticket);

const permitted = canEnter(room, guest);
if (!permitted) {
  return inviteToLobby();
}
```

The gap splits preparation from the check it prepares. The final declaration gets buried against the guard.

### One save includes several calls

The sketches and the entry are all part of the exhibit save.

**Good here**

```ts
await archiveSketch(original);
await archiveSketch(revision);
await recordExhibitEntry(title);
```

**Bad here**

```ts
await archiveSketch(original);
await archiveSketch(revision);

await recordExhibitEntry(title);
```

### A small result and its return

**Good here**

```ts
const seatsRemaining = seats.length;
return seatsRemaining > 0;
```

**Bad here**

```ts
const seatsRemaining = seats.length;

return seatsRemaining > 0;
```

The return completes the only operation in this block.
