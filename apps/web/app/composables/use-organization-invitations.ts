import type { Ref } from 'vue';
import { safeParse } from 'valibot';

type Query = { action: 'list-mine' } | { action: 'list-pending'; organizationId: string };
type Invitation = { id: string; expiresAt: string };
type InvitationPage<Item> = { items: Item[]; nextCursor: string | null };
type LoadMode = 'first' | 'next';
type InvitationList<Item> = {
  items: Readonly<Ref<readonly Item[]>>;
  nextCursor: Readonly<Ref<string | null>>;
  pending: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  load: (mode: LoadMode) => Promise<void>;
  remove: (id: string) => void;
};

export const organizationInvitationsEndpoint = '/api/auth/account/organization-invitations';

export function useOrganizationInvitations<Item extends Invitation>(
  query: () => Query,
  requireVerification?: () => void,
): InvitationList<Item> {
  const items = shallowRef<Item[]>([]);
  const nextCursor = shallowRef<string | null>(null);
  const pending = shallowRef<boolean>(false);
  const error = shallowRef<string | null>(null);

  async function load(mode: LoadMode): Promise<void> {
    if (pending.value || (mode === 'next' && !nextCursor.value)) {
      return;
    }

    pending.value = true;
    error.value = null;

    try {
      const selection = query();
      const cursor = nextCursor.value;
      const body = mode === 'next' && cursor ? { ...selection, cursor } : selection;
      const page = await $fetch<InvitationPage<Item>>(organizationInvitationsEndpoint, {
        method: 'POST',
        retry: 0,
        body,
      });
      items.value = mode === 'next' ? [...items.value, ...page.items] : page.items;
      nextCursor.value = page.nextCursor;
    } catch (error_) {
      const result = safeParse(adminErrorSchema, error_);
      const failure = result.success ? result.output : null;
      if (failure?.data?.code === 'PASSKEY_REQUIRED') {
        requireVerification?.();
      } else {
        error.value = adminRequestMessage(failure, 'Could not load invitations.');
      }
    } finally {
      pending.value = false;
    }
  }

  function remove(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  onMounted(async () => load('first'));

  return {
    items: shallowReadonly(items),
    nextCursor: readonly(nextCursor),
    pending: readonly(pending),
    error: readonly(error),
    load,
    remove,
  };
}
