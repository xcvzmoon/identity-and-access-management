import type { Ref } from 'vue';

type AccountAction = {
  pending: Ref<boolean>;
  error: Ref<string>;
  submit: (action: () => Promise<void>, fallback: string) => Promise<void>;
};

export function useAccountAction(): AccountAction {
  const pending = ref(false);
  const error = ref('');

  async function submit(action: () => Promise<void>, fallback: string): Promise<void> {
    if (pending.value) {
      return;
    }

    error.value = '';
    pending.value = true;

    try {
      await action();
    } catch {
      error.value = fallback;
    } finally {
      pending.value = false;
    }
  }

  return { error, pending, submit };
}
