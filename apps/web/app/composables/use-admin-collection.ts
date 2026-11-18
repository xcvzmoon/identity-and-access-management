import type { ComputedRef, Ref } from 'vue';
import { safeParse } from 'valibot';

type Page<Item> = {
  items: Item[];
  nextCursor: string | null;
};

type AccessQuery =
  | { collection: 'apps'; organizationId: string }
  | { collection: 'permissions' | 'roles'; installationId: string }
  | {
      collection: 'organization-members' | 'ownership-candidates';
      organizationId: string;
      search: string;
    }
  | { collection: 'members'; installationId: string; search: string };

type LoadMode = 'first' | 'next';
type AdminCollection<Item> = {
  items: Readonly<Ref<readonly Item[]>>;
  hasMore: ComputedRef<boolean>;
  pending: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  load: (mode: LoadMode) => Promise<void>;
  upsert: (item: Item) => void;
};

export function useAdminCollection<Item>(
  query: () => AccessQuery,
  keyOf: (item: Item) => string,
  requireVerification: () => void,
): AdminCollection<Item> {
  const items = shallowRef<Item[]>([]);
  const nextCursor = shallowRef<string | null>(null);
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);

  function merge(existing: Item[], incoming: Item[]): Item[] {
    const merged = new Map(existing.map((item) => [keyOf(item), item]));

    for (const item of incoming) {
      merged.set(keyOf(item), item);
    }

    return [...merged.values()];
  }

  async function load(mode: LoadMode): Promise<void> {
    if (pending.value || (mode === 'next' && !nextCursor.value)) {
      return;
    }

    pending.value = true;
    error.value = null;

    if (mode === 'first') {
      items.value = [];
      nextCursor.value = null;
    }

    try {
      const selection = query();
      const cursor = nextCursor.value;
      const body = mode === 'next' && cursor ? { ...selection, cursor } : selection;
      const page = await $fetch<Page<Item>>('/api/auth/admin/access', {
        method: 'POST',
        retry: 0,
        body,
      });
      items.value = merge(items.value, page.items);
      nextCursor.value = page.nextCursor;
    } catch (error_) {
      const parsed = safeParse(adminErrorSchema, error_);
      const failure = parsed.success ? parsed.output : null;
      if (failure?.data?.code === 'PASSKEY_REQUIRED') {
        requireVerification();
      } else {
        error.value = adminRequestMessage(failure, 'Could not load this list. Try again.');
      }
    } finally {
      pending.value = false;
    }
  }

  function upsert(item: Item): void {
    items.value = merge(items.value, [item]);
  }

  onMounted(async () => load('first'));

  return {
    items: shallowReadonly(items),
    hasMore: computed<boolean>(() => nextCursor.value !== null),
    pending: readonly(pending),
    error: readonly(error),
    load,
    upsert,
  };
}
